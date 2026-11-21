"""App Store の定期購読をサーバー側で検証する(PRICING_DESIGN.md 6章)。

- `verify_jws`: StoreKit 2 / App Store Server Notifications V2 の JWS を検証する
  (x5c の証明書チェーン → 設定したルート証明書とのバイト一致 → 有効期限 → ES256 署名)
- `apply_signed_transaction`: iOS から送られた JWSTransaction(購入・復元)を購読に反映する
- `apply_notification`: App Store Server Notifications V2 の signedPayload を購読に反映する

ネットワークにはアクセスしない(App Store Server API は呼ばない)。本物の Apple のルート証明書はリポジトリに入れず、
本番では人間が配置したファイルを設定 `apple.root_cert_paths` で指定する。1つも無ければ検証は必ず失敗する。
"""
import base64
import json
import time

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from . import store as store_mod

SUBSCRIPTION_TYPE = "Auto-Renewable Subscription"

# Apple の証明書に付く拡張(Apple の app-store-server-library と同じ確認)。自前のテスト用チェーンにも付ける
OID_LEAF_RECEIPT_SIGNING = x509.ObjectIdentifier("1.2.840.113635.100.6.11.1")
OID_WWDR_INTERMEDIATE = x509.ObjectIdentifier("1.2.840.113635.100.6.2.1")

EXTEND = ("SUBSCRIBED", "DID_RENEW")
EXPIRE = ("EXPIRED", "GRACE_PERIOD_EXPIRED")
REVOKE = ("REFUND", "REVOKE")
RENEWAL_STATUS = ("DID_CHANGE_RENEWAL_STATUS",)
HANDLED = EXTEND + EXPIRE + REVOKE + RENEWAL_STATUS
# DID_CHANGE_RENEWAL_PREF(次回の商品の変更)とそれ以外は、記録だけして無視する


class AppStoreVerificationError(Exception):
    """JWS・証明書チェーン・取引の内容の検証に失敗した"""


# ------------------------------------------------------------------ JWS の検証
def _b64url(s):
    if not isinstance(s, str) or not s or any(ch in s for ch in "=+/ \n"):
        raise AppStoreVerificationError("base64url の形式ではありません")
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _load_roots(cfg):
    paths = list((cfg.apple or {}).get("root_cert_paths") or [])
    if not paths:
        raise AppStoreVerificationError("ルート証明書が設定されていません(apple.root_cert_paths)")
    roots = []
    for p in paths:
        try:
            with open(p, "rb") as f:
                data = f.read()
            if b"-----BEGIN" in data:
                certs = x509.load_pem_x509_certificates(data)
            else:
                certs = [x509.load_der_x509_certificate(data)]
        except (OSError, ValueError) as e:
            raise AppStoreVerificationError(f"ルート証明書を読めません: {p}: {e}") from e
        roots.extend(c.public_bytes(serialization.Encoding.DER) for c in certs)
    if not roots:
        raise AppStoreVerificationError("ルート証明書が空です")
    return roots


def _check_validity(cert, now, label):
    if not (cert.not_valid_before_utc.timestamp() <= now <= cert.not_valid_after_utc.timestamp()):
        raise AppStoreVerificationError(f"{label}の証明書が有効期限外です")


def _is_ca(cert):
    try:
        return bool(cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca)
    except x509.ExtensionNotFound:
        return False


def _has_ext(cert, oid):
    try:
        cert.extensions.get_extension_for_oid(oid)
        return True
    except x509.ExtensionNotFound:
        return False


def _verify_chain(x5c, cfg, now):
    if not isinstance(x5c, list) or len(x5c) != 3 or not all(isinstance(c, str) for c in x5c):
        raise AppStoreVerificationError("x5c は 葉・中間・ルート の3つの証明書が必要です")
    roots = _load_roots(cfg)
    try:
        ders = [base64.b64decode(c, validate=True) for c in x5c]
        leaf, inter, root = (x509.load_der_x509_certificate(d) for d in ders)
    except ValueError as e:
        raise AppStoreVerificationError(f"x5c の証明書を読めません: {e}") from e
    if ders[2] not in roots:
        raise AppStoreVerificationError("ルート証明書が設定のものと一致しません")
    for cert, label in ((leaf, "葉"), (inter, "中間"), (root, "ルート")):
        _check_validity(cert, now, label)
    if not _is_ca(inter):
        raise AppStoreVerificationError("中間証明書が CA ではありません")
    if not _has_ext(leaf, OID_LEAF_RECEIPT_SIGNING) or not _has_ext(inter, OID_WWDR_INTERMEDIATE):
        raise AppStoreVerificationError("App Store の署名用の証明書ではありません(拡張がありません)")
    try:
        leaf.verify_directly_issued_by(inter)
        inter.verify_directly_issued_by(root)
    except (ValueError, TypeError, InvalidSignature) as e:
        raise AppStoreVerificationError(f"証明書チェーンの署名が正しくありません: {e}") from e
    key = leaf.public_key()
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise AppStoreVerificationError("葉の公開鍵が P-256 ではありません")
    return key


def verify_jws(token, cfg, now=None):
    """JWS を検証して payload(dict)を返す。失敗したら AppStoreVerificationError"""
    now = time.time() if now is None else float(now)
    if not isinstance(token, str):
        raise AppStoreVerificationError("JWS が文字列ではありません")
    parts = token.split(".")
    if len(parts) != 3:
        raise AppStoreVerificationError("JWS の形式ではありません")
    try:
        header = json.loads(_b64url(parts[0]))
        payload = json.loads(_b64url(parts[1]))
        sig = _b64url(parts[2])
    except (ValueError, UnicodeDecodeError) as e:
        raise AppStoreVerificationError(f"JWS を読めません: {e}") from e
    if not isinstance(header, dict) or not isinstance(payload, dict):
        raise AppStoreVerificationError("JWS のヘッダ・payload が JSON オブジェクトではありません")
    if header.get("alg") != "ES256":
        raise AppStoreVerificationError(f"受け付けない alg です: {header.get('alg')!r}")
    if header.get("crit"):
        raise AppStoreVerificationError("crit ヘッダには対応していません")
    key = _verify_chain(header.get("x5c"), cfg, now)
    if len(sig) != 64:
        raise AppStoreVerificationError("ES256 の署名の長さが正しくありません")
    der_sig = encode_dss_signature(int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big"))
    try:
        key.verify(der_sig, (parts[0] + "." + parts[1]).encode("ascii"), ec.ECDSA(hashes.SHA256()))
    except InvalidSignature as e:
        raise AppStoreVerificationError("署名が正しくありません") from e
    return payload


# ------------------------------------------------------------------ 取引の内容の検証
def _check_app(cfg, bundle_id, environment):
    apple = cfg.apple or {}
    expected = apple.get("bundle_id")
    if not expected or bundle_id != expected:
        raise AppStoreVerificationError(f"bundleId が一致しません: {bundle_id!r}")
    if environment not in (apple.get("environments") or ()):
        raise AppStoreVerificationError(f"受け付けない環境です: {environment!r}")


def _check_transaction(cfg, tx):
    _check_app(cfg, tx.get("bundleId"), tx.get("environment"))
    if tx.get("type") != SUBSCRIPTION_TYPE:
        raise AppStoreVerificationError(f"自動更新の定期購読ではありません: {tx.get('type')!r}")
    if cfg.plan_for_product(tx.get("productId")) is None:
        raise AppStoreVerificationError(f"設定に無い商品 ID です: {tx.get('productId')!r}")
    for k in ("transactionId", "originalTransactionId"):
        if not tx.get(k):
            raise AppStoreVerificationError(f"{k} がありません")
    if not isinstance(tx.get("expiresDate"), (int, float)) or isinstance(tx.get("expiresDate"), bool):
        raise AppStoreVerificationError("expiresDate がありません")


def _ms(v):
    return None if v is None else float(v) / 1000.0


def _revoked_at(tx, existing):
    """取引の revocationDate を優先する。無い取引で、既に取り消し済みの購読を取り消し前の取引で戻さない"""
    if tx.get("revocationDate") is not None:
        return _ms(tx["revocationDate"])
    if existing and existing.get("revoked_at") is not None:
        purchased = _ms(tx.get("purchaseDate"))
        if purchased is None or purchased <= existing["revoked_at"]:
            return existing["revoked_at"]
    return None


def _upsert(store, account_id, tx, existing, *, auto_renew=None, revoked_at=None):
    if auto_renew is None:
        auto_renew = bool(existing["auto_renew"]) if existing else True
    if revoked_at is None:
        revoked_at = _revoked_at(tx, existing)
    return store.upsert_subscription(
        account_id, str(tx["originalTransactionId"]), tx["productId"], _ms(tx["expiresDate"]),
        environment=tx.get("environment"), last_transaction_id=str(tx["transactionId"]),
        auto_renew=auto_renew, source="apple", revoked_at=revoked_at)


def _result(sub, duplicate):
    return {"original_transaction_id": sub["original_transaction_id"], "plan": sub["plan"],
            "expires_at": sub["expires_at"], "revoked": sub["revoked_at"] is not None, "duplicate": duplicate}


# ------------------------------------------------------------------ 購入・復元
def apply_signed_transaction(store, cfg, account_id, signed_transaction, now=None):
    """iOS から送られた JWSTransaction(購入・復元)を検証して購読に反映する。

    別のアカウントに結び付いた購読なら store.SubscriptionConflict(409 相当)。同じ取引の再送は冪等。
    """
    tx = verify_jws(signed_transaction, cfg, now)
    _check_transaction(cfg, tx)
    account = store.account(account_id)
    token = tx.get("appAccountToken")
    if token and str(token).lower() != str(account["app_account_token"]).lower():
        raise AppStoreVerificationError("appAccountToken がアカウントと一致しません")
    otid = str(tx["originalTransactionId"])
    with store._tx():                     # 重複の記録と購読の更新を1トランザクションにする(失敗したら記録も戻す)
        existing = store.subscription(otid)
        if existing and existing["account_id"] != account_id:
            raise store_mod.SubscriptionConflict(otid)
        if not store.mark_event("tx:" + str(tx["transactionId"]), "transaction"):
            if existing:
                return _result(existing, True)
            # 記録はあるのに購読が無い(手で消された等)。登録し直す
            return _result(_upsert(store, account_id, tx, None), True)
        return _result(_upsert(store, account_id, tx, existing), False)


# ------------------------------------------------------------------ 通知
def apply_notification(store, cfg, signed_payload, now=None):
    """App Store Server Notifications V2 の signedPayload を検証して購読に反映する"""
    n = verify_jws(signed_payload, cfg, now)
    ntype = n.get("notificationType")
    uid = n.get("notificationUUID")
    data = n.get("data")
    if not ntype or not uid or not isinstance(data, dict):
        raise AppStoreVerificationError("通知の形式ではありません")
    _check_app(cfg, data.get("bundleId"), data.get("environment"))
    tx = renewal = None
    if data.get("signedTransactionInfo"):
        tx = verify_jws(data["signedTransactionInfo"], cfg, now)
    if data.get("signedRenewalInfo"):
        renewal = verify_jws(data["signedRenewalInfo"], cfg, now)
    out = {"type": ntype}
    if n.get("subtype"):
        out["subtype"] = n["subtype"]

    if ntype not in HANDLED:
        ok = store.mark_event("n:" + str(uid), ntype)
        return dict(out, status="ignored" if ok else "duplicate")

    if tx is None:
        raise AppStoreVerificationError(f"{ntype} の通知に signedTransactionInfo がありません")
    _check_transaction(cfg, tx)
    if tx.get("bundleId") != data.get("bundleId") or tx.get("environment") != data.get("environment"):
        raise AppStoreVerificationError("通知と取引の bundleId・環境が一致しません")
    otid = str(tx["originalTransactionId"])
    if renewal is not None and str(renewal.get("originalTransactionId", otid)) != otid:
        raise AppStoreVerificationError("renewalInfo と取引の originalTransactionId が一致しません")

    with store._tx():                     # 重複の記録と購読の更新を1トランザクションにする
        existing = store.subscription(otid)
        if existing:
            account_id = existing["account_id"]
        else:
            acc = store.account_by_token(tx["appAccountToken"]) if tx.get("appAccountToken") else None
            if acc is None:
                return dict(out, status="unknown_account")        # 何も変えない(記録もしない)
            account_id = acc["id"]
        if not store.mark_event("n:" + str(uid), ntype):
            return dict(out, status="duplicate")

        renew_status = None
        if renewal is not None and renewal.get("autoRenewStatus") is not None:
            renew_status = int(renewal["autoRenewStatus"]) == 1
        if ntype in EXTEND:
            sub = _upsert(store, account_id, tx, existing, auto_renew=renew_status)
        elif ntype in RENEWAL_STATUS:
            # 自動更新の有無だけ変える。失効日時はそのまま(期間の終わりまで有効)
            sub = _upsert(store, account_id, tx, existing, auto_renew=renew_status)
        elif ntype in EXPIRE:
            # 失効日時 = 取引の expiresDate。ただし後の更新が既に届いていれば短くしない(store の max)
            sub = _upsert(store, account_id, tx, existing, auto_renew=False)
        else:                                                     # REFUND / REVOKE: 直ちに無効
            revoked = _ms(tx.get("revocationDate"))
            if revoked is None:
                revoked = _ms(n.get("signedDate")) or (time.time() if now is None else float(now))
            sub = _upsert(store, account_id, tx, existing, revoked_at=revoked)
        return dict(out, status="applied", original_transaction_id=sub["original_transaction_id"],
                    plan=sub["plan"], expires_at=sub["expires_at"], revoked=sub["revoked_at"] is not None)
