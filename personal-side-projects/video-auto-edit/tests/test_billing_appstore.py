"""App Store の定期購読のサーバー側検証(vae/billing/appstore.py)。

証明書チェーン(ルート → 中間 → 葉、ECDSA P-256)と JWS はテストの中で作る。本物の Apple の証明書は使わない。
AC-P10 購入の検証 / AC-P11 復元 / AC-P12 解約・失効 / AC-P13 返金 / AC-P14 二重登録防止
"""
import base64
import dataclasses
import datetime as dt
import json
import time
import uuid

import pytest

pytest.importorskip("cryptography")

from cryptography import x509  # noqa: E402
from cryptography.hazmat.primitives import hashes, hmac, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature  # noqa: E402
from cryptography.x509.oid import NameOID  # noqa: E402

from vae.billing import appstore, config as billing_config, store as billing_store  # noqa: E402
from vae.billing.appstore import AppStoreVerificationError  # noqa: E402

BUNDLE = "com.example.videoautoedit"
STANDARD = "com.example.videoautoedit.standard.monthly"
PRO = "com.example.videoautoedit.pro.monthly"
DAY = 86400.0
NOW = time.time()


# ------------------------------------------------------------------ テスト用の証明書と JWS
def _name(cn):
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def _cert(subject, key, issuer, issuer_key, *, ca, ext_oid=None, not_before=None, not_after=None):
    nb = not_before or dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=60)
    na = not_after or dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=365)
    b = (x509.CertificateBuilder().subject_name(_name(subject)).issuer_name(_name(issuer))
         .public_key(key.public_key()).serial_number(x509.random_serial_number())
         .not_valid_before(nb).not_valid_after(na)
         .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True))
    if ext_oid is not None:
        b = b.add_extension(x509.UnrecognizedExtension(ext_oid, b"\x05\x00"), critical=False)
    return b.sign(issuer_key, hashes.SHA256())


class PKI:
    def __init__(self, root_name="Test Root CA", *, leaf_not_after=None, leaf_not_before=None):
        self.root_key = ec.generate_private_key(ec.SECP256R1())
        self.inter_key = ec.generate_private_key(ec.SECP256R1())
        self.leaf_key = ec.generate_private_key(ec.SECP256R1())
        self.root = _cert(root_name, self.root_key, root_name, self.root_key, ca=True)
        self.inter = _cert("Test Intermediate", self.inter_key, root_name, self.root_key, ca=True,
                           ext_oid=appstore.OID_WWDR_INTERMEDIATE)
        self.leaf = _cert("Test Leaf", self.leaf_key, "Test Intermediate", self.inter_key, ca=False,
                          ext_oid=appstore.OID_LEAF_RECEIPT_SIGNING, not_before=leaf_not_before,
                          not_after=leaf_not_after)

    def x5c(self):
        return [base64.b64encode(c.public_bytes(serialization.Encoding.DER)).decode()
                for c in (self.leaf, self.inter, self.root)]

    def root_pem(self):
        return self.root.public_bytes(serialization.Encoding.PEM)


def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def sign(pki, payload, *, alg="ES256", header=None):
    h = {"alg": alg, "x5c": pki.x5c()} if header is None else header
    signing_input = _b64(json.dumps(h).encode()) + "." + _b64(json.dumps(payload).encode())
    if alg == "ES256":
        r, s = decode_dss_signature(pki.leaf_key.sign(signing_input.encode(), ec.ECDSA(hashes.SHA256())))
        sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    elif alg == "HS256":
        mac = hmac.HMAC(b"secret", hashes.SHA256())
        mac.update(signing_input.encode())
        sig = mac.finalize()
    else:
        sig = b""
    return signing_input + "." + _b64(sig)


def tx_payload(token, *, tid=None, otid="1000", product=STANDARD, expires=None, purchase=None, **kw):
    p = {"transactionId": tid or uuid.uuid4().hex[:12], "originalTransactionId": otid, "bundleId": BUNDLE,
         "productId": product, "type": "Auto-Renewable Subscription", "environment": "Sandbox",
         "purchaseDate": int((purchase or NOW - DAY) * 1000), "expiresDate": int((expires or NOW + 30 * DAY) * 1000),
         "signedDate": int(NOW * 1000)}
    if token is not None:
        p["appAccountToken"] = token
    p.update(kw)
    return p


def notification(pki, ntype, tx, *, renewal=None, uid=None, subtype=None, bundle=BUNDLE, env="Sandbox"):
    data = {"bundleId": bundle, "environment": env, "signedTransactionInfo": sign(pki, tx)}
    if renewal is not None:
        data["signedRenewalInfo"] = sign(pki, renewal)
    n = {"notificationType": ntype, "notificationUUID": uid or str(uuid.uuid4()), "data": data,
         "version": "2.0", "signedDate": int(NOW * 1000)}
    if subtype:
        n["subtype"] = subtype
    return sign(pki, n)


# ------------------------------------------------------------------ フィクスチャ
@pytest.fixture(scope="module")
def pki():
    return PKI()


@pytest.fixture
def cfg(pki, tmp_path):
    root = tmp_path / "root.pem"
    root.write_bytes(pki.root_pem())
    base = billing_config.load()          # リポジトリの config/plans.json
    return dataclasses.replace(base, apple=dict(base.apple, root_cert_paths=[str(root)]))


@pytest.fixture
def st(cfg, tmp_path):
    return billing_store.BillingStore(str(tmp_path / "db" / "vae.db"), cfg)


@pytest.fixture
def acc(st):
    return st.account_for_client("client-a")


def plan_of(st, acc, now=None):
    return st.effective_plan(acc["id"], now)[0].name


# ------------------------------------------------------------------ AC-P10 購入の検証
def test_ac_p10_purchase_makes_standard(st, cfg, pki, acc):
    assert plan_of(st, acc) == "free"
    r = appstore.apply_signed_transaction(st, cfg, acc["id"], sign(pki, tx_payload(acc["app_account_token"])))
    assert r["plan"] == "standard" and r["duplicate"] is False and r["revoked"] is False
    assert r["original_transaction_id"] == "1000"
    assert plan_of(st, acc) == "standard"


def test_ac_p10_token_case_insensitive(st, cfg, pki, acc):
    tok = acc["app_account_token"].upper()
    appstore.apply_signed_transaction(st, cfg, acc["id"], sign(pki, tx_payload(tok)))
    assert plan_of(st, acc) == "standard"


def test_ac_p10_verify_jws_returns_payload(cfg, pki):
    p = tx_payload(None)
    assert appstore.verify_jws(sign(pki, p), cfg) == p


def test_ac_p10_app_account_token_mismatch_rejected(st, cfg, pki, acc):
    with pytest.raises(AppStoreVerificationError):
        appstore.apply_signed_transaction(st, cfg, acc["id"], sign(pki, tx_payload(str(uuid.uuid4()))))
    assert plan_of(st, acc) == "free"


def test_ac_p10_fake_root_rejected(st, cfg, acc):
    fake = PKI("Test Root CA")            # 同じ名前の別のルート
    with pytest.raises(AppStoreVerificationError):
        appstore.apply_signed_transaction(st, cfg, acc["id"], sign(fake, tx_payload(acc["app_account_token"])))
    assert plan_of(st, acc) == "free"


def test_ac_p10_chain_with_foreign_intermediate_rejected(cfg, pki):
    """ルートは本物(設定のもの)だが、中間・葉が別のルートに署名されている"""
    other = PKI("Other Root")
    header = {"alg": "ES256", "x5c": other.x5c()[:2] + [pki.x5c()[2]]}
    with pytest.raises(AppStoreVerificationError):
        appstore.verify_jws(sign(other, tx_payload(None), header=header), cfg)


def test_ac_p10_tampered_payload_rejected(cfg, pki):
    h, p, s = sign(pki, tx_payload(None)).split(".")
    forged = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
    forged["productId"] = PRO
    forged["expiresDate"] += int(365 * DAY * 1000)
    with pytest.raises(AppStoreVerificationError):
        appstore.verify_jws(h + "." + _b64(json.dumps(forged).encode()) + "." + s, cfg)


@pytest.mark.parametrize("alg", ["none", "HS256", "ES384", "RS256"])
def test_ac_p10_other_alg_rejected(cfg, pki, alg):
    with pytest.raises(AppStoreVerificationError):
        appstore.verify_jws(sign(pki, tx_payload(None), alg=alg), cfg)


def test_ac_p10_missing_x5c_rejected(cfg, pki):
    with pytest.raises(AppStoreVerificationError):
        appstore.verify_jws(sign(pki, tx_payload(None), header={"alg": "ES256"}), cfg)


def test_ac_p10_expired_leaf_cert_rejected(cfg, tmp_path):
    old = PKI("Expired Root", leaf_not_before=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30),
              leaf_not_after=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1))
    root = tmp_path / "expired_root.der"
    root.write_bytes(old.root.public_bytes(serialization.Encoding.DER))       # DER のルートも読める
    c = dataclasses.replace(cfg, apple=dict(cfg.apple, root_cert_paths=[str(root)]))
    with pytest.raises(AppStoreVerificationError, match="有効期限"):
        appstore.verify_jws(sign(old, tx_payload(None)), c)
    # 同じ JWS でも、証明書が有効だった時点(now)なら通る = 期限の判定が now を使っている
    assert appstore.verify_jws(sign(old, tx_payload(None)), c, now=time.time() - 10 * DAY)


def test_ac_p10_no_root_configured_always_fails(cfg, pki):
    c = dataclasses.replace(cfg, apple=dict(cfg.apple, root_cert_paths=[]))
    with pytest.raises(AppStoreVerificationError, match="ルート証明書"):
        appstore.verify_jws(sign(pki, tx_payload(None)), c)
    with pytest.raises(AppStoreVerificationError):
        appstore.verify_jws(sign(pki, tx_payload(None)), dataclasses.replace(cfg, apple={}))


def test_ac_p10_repo_config_has_no_root(pki):
    """リポジトリの設定にはルート証明書が無い(本物は人間が配置する)ので、必ず失敗する"""
    with pytest.raises(AppStoreVerificationError):
        appstore.verify_jws(sign(pki, tx_payload(None)), billing_config.load())


@pytest.mark.parametrize("field,value", [("bundleId", "com.other.app"), ("environment", "Xcode"),
                                         ("productId", "com.example.unknown"), ("type", "Non-Consumable")])
def test_ac_p10_wrong_transaction_fields_rejected(st, cfg, pki, acc, field, value):
    p = tx_payload(acc["app_account_token"], **{field: value})
    with pytest.raises(AppStoreVerificationError):
        appstore.apply_signed_transaction(st, cfg, acc["id"], sign(pki, p))
    assert plan_of(st, acc) == "free"


# ------------------------------------------------------------------ AC-P11 復元・再送
def test_ac_p11_resend_same_transaction_is_idempotent(st, cfg, pki, acc):
    jws = sign(pki, tx_payload(acc["app_account_token"], tid="t1"))
    r1 = appstore.apply_signed_transaction(st, cfg, acc["id"], jws)
    r2 = appstore.apply_signed_transaction(st, cfg, acc["id"], jws)
    assert r1["duplicate"] is False and r2["duplicate"] is True
    assert r1["expires_at"] == r2["expires_at"] and r2["plan"] == "standard"
    n = st._conn().execute("SELECT COUNT(*) FROM subscriptions").fetchone()[0]
    assert n == 1


def test_ac_p11_restore_multiple_transactions(st, cfg, pki, acc):
    tok = acc["app_account_token"]
    first = tx_payload(tok, tid="t1", otid="1000", expires=NOW - 5 * DAY, purchase=NOW - 35 * DAY)
    renewal = tx_payload(tok, tid="t2", otid="1000", expires=NOW + 25 * DAY, purchase=NOW - 5 * DAY)
    pro = tx_payload(tok, tid="p1", otid="2000", product=PRO, expires=NOW + 10 * DAY)
    for p in (first, renewal, pro):
        appstore.apply_signed_transaction(st, cfg, acc["id"], sign(pki, p))
    assert st.subscription("1000")["expires_at"] == pytest.approx(NOW + 25 * DAY, abs=0.01)
    assert plan_of(st, acc) == "pro"
    assert plan_of(st, acc, now=NOW + 15 * DAY) == "standard"       # PRO が切れた後は STANDARD


def test_ac_p11_old_transaction_does_not_shorten_expiry(st, cfg, pki, acc):
    tok = acc["app_account_token"]
    appstore.apply_signed_transaction(st, cfg, acc["id"], sign(pki, tx_payload(tok, tid="t2", expires=NOW + 25 * DAY)))
    r = appstore.apply_signed_transaction(st, cfg, acc["id"],
                                          sign(pki, tx_payload(tok, tid="t1", expires=NOW - 5 * DAY)))
    assert r["expires_at"] == pytest.approx(NOW + 25 * DAY, abs=0.01)
    assert plan_of(st, acc) == "standard"


def test_ac_p11_transaction_without_token_is_accepted(st, cfg, pki, acc):
    """appAccountToken の無い取引(アプリが渡し忘れた古い購入)は、送ってきたアカウントに結び付ける"""
    appstore.apply_signed_transaction(st, cfg, acc["id"], sign(pki, tx_payload(None)))
    assert plan_of(st, acc) == "standard"


# ------------------------------------------------------------------ AC-P14 二重登録防止
def test_ac_p14_other_account_subscription_conflict(st, cfg, pki, acc):
    other = st.account_for_client("client-b")
    appstore.apply_signed_transaction(st, cfg, acc["id"], sign(pki, tx_payload(None, tid="t1")))
    # 別のアカウントから、同じ購読の別の取引・同じ取引の再送のどちらも 409 相当
    with pytest.raises(billing_store.SubscriptionConflict):
        appstore.apply_signed_transaction(st, cfg, other["id"], sign(pki, tx_payload(None, tid="t2")))
    with pytest.raises(billing_store.SubscriptionConflict):
        appstore.apply_signed_transaction(st, cfg, other["id"], sign(pki, tx_payload(None, tid="t1")))
    assert plan_of(st, other) == "free" and plan_of(st, acc) == "standard"
    assert st.subscription("1000")["account_id"] == acc["id"]


def test_ac_p14_conflict_does_not_consume_event(st, cfg, pki, acc):
    """拒否した取引は重複の記録にも残さない(正しいアカウントから後で送れば通る)"""
    other = st.account_for_client("client-b")
    appstore.apply_signed_transaction(st, cfg, acc["id"], sign(pki, tx_payload(None, tid="t1")))
    jws = sign(pki, tx_payload(None, tid="t9", expires=NOW + 60 * DAY))
    with pytest.raises(billing_store.SubscriptionConflict):
        appstore.apply_signed_transaction(st, cfg, other["id"], jws)
    r = appstore.apply_signed_transaction(st, cfg, acc["id"], jws)
    assert r["duplicate"] is False and r["expires_at"] == pytest.approx(NOW + 60 * DAY, abs=0.01)


# ------------------------------------------------------------------ 通知(AC-P12 解約・失効、AC-P13 返金)
@pytest.fixture
def subscribed(st, cfg, pki, acc):
    tok = acc["app_account_token"]
    appstore.apply_signed_transaction(st, cfg, acc["id"], sign(pki, tx_payload(tok, tid="t1", expires=NOW + 5 * DAY)))
    return tok


def test_ac_p12_did_renew_extends(st, cfg, pki, acc, subscribed):
    tx = tx_payload(subscribed, tid="t2", expires=NOW + 35 * DAY, purchase=NOW + 5 * DAY)
    r = appstore.apply_notification(st, cfg, notification(pki, "DID_RENEW", tx))
    assert r["status"] == "applied" and r["type"] == "DID_RENEW"
    assert st.subscription("1000")["expires_at"] == pytest.approx(NOW + 35 * DAY, abs=0.01)
    assert plan_of(st, acc, now=NOW + 20 * DAY) == "standard"


def test_ac_p12_auto_renew_off_stays_active_until_period_end(st, cfg, pki, acc, subscribed):
    tx = tx_payload(subscribed, tid="t1", expires=NOW + 5 * DAY)
    renewal = {"originalTransactionId": "1000", "autoRenewStatus": 0, "autoRenewProductId": STANDARD,
               "productId": STANDARD, "environment": "Sandbox"}
    r = appstore.apply_notification(st, cfg, notification(pki, "DID_CHANGE_RENEWAL_STATUS", tx, renewal=renewal,
                                                          subtype="AUTO_RENEW_DISABLED"))
    assert r["status"] == "applied"
    sub = st.subscription("1000")
    assert sub["auto_renew"] == 0 and sub["expires_at"] == pytest.approx(NOW + 5 * DAY, abs=0.01)
    assert plan_of(st, acc) == "standard"                          # 期間内は有効
    assert plan_of(st, acc, now=NOW + 6 * DAY) == "free"           # 期間の後は free


def test_ac_p12_expired_returns_to_free(st, cfg, pki, acc, subscribed):
    tx = tx_payload(subscribed, tid="t1", expires=NOW + 5 * DAY)
    r = appstore.apply_notification(st, cfg, notification(pki, "EXPIRED", tx, subtype="VOLUNTARY"))
    assert r["status"] == "applied"
    assert st.subscription("1000")["auto_renew"] == 0
    assert plan_of(st, acc, now=NOW + 5 * DAY + 1) == "free"


def test_ac_p12_old_notification_does_not_shorten(st, cfg, pki, acc, subscribed):
    appstore.apply_notification(st, cfg, notification(pki, "DID_RENEW", tx_payload(subscribed, tid="t2",
                                                                                     expires=NOW + 35 * DAY)))
    appstore.apply_notification(st, cfg, notification(pki, "DID_RENEW", tx_payload(subscribed, tid="t1",
                                                                                     expires=NOW + 5 * DAY)))
    assert st.subscription("1000")["expires_at"] == pytest.approx(NOW + 35 * DAY, abs=0.01)


def test_ac_p13_refund_is_immediately_free(st, cfg, pki, acc, subscribed):
    tx = tx_payload(subscribed, tid="t1", expires=NOW + 5 * DAY, revocationDate=int((NOW - 60) * 1000),
                    revocationReason=0)
    r = appstore.apply_notification(st, cfg, notification(pki, "REFUND", tx))
    assert r["status"] == "applied" and r["revoked"] is True
    assert plan_of(st, acc) == "free"
    # 取り消し前の取引を後から再送しても、有効に戻らない
    appstore.apply_signed_transaction(st, cfg, acc["id"], sign(pki, tx_payload(subscribed, tid="t1-again",
                                                                                expires=NOW + 5 * DAY)))
    assert plan_of(st, acc) == "free"


def test_ac_p13_revoke_without_revocation_date_uses_signed_date(st, cfg, pki, acc, subscribed):
    r = appstore.apply_notification(st, cfg, notification(pki, "REVOKE", tx_payload(subscribed, tid="t1")))
    assert r["revoked"] is True and plan_of(st, acc) == "free"


def test_ac_p12_duplicate_notification_applied_once(st, cfg, pki, acc, subscribed):
    uid = str(uuid.uuid4())
    jws = notification(pki, "DID_RENEW", tx_payload(subscribed, tid="t2", expires=NOW + 35 * DAY), uid=uid)
    assert appstore.apply_notification(st, cfg, jws)["status"] == "applied"
    # 同じ UUID の通知(別の内容でも)は反映しない
    jws2 = notification(pki, "DID_RENEW", tx_payload(subscribed, tid="t3", expires=NOW + 65 * DAY), uid=uid)
    assert appstore.apply_notification(st, cfg, jws)["status"] == "duplicate"
    assert appstore.apply_notification(st, cfg, jws2)["status"] == "duplicate"
    assert st.subscription("1000")["expires_at"] == pytest.approx(NOW + 35 * DAY, abs=0.01)


def test_ac_p10_subscribed_notification_before_app_registers(st, cfg, pki, acc):
    """アプリより先に SUBSCRIBED 通知が届いても、appAccountToken でアカウントを決めて登録する"""
    r = appstore.apply_notification(st, cfg, notification(pki, "SUBSCRIBED", tx_payload(acc["app_account_token"]),
                                                          subtype="INITIAL_BUY"))
    assert r["status"] == "applied" and plan_of(st, acc) == "standard"


def test_ac_p14_unknown_account_changes_nothing(st, cfg, pki):
    uid = str(uuid.uuid4())
    jws = notification(pki, "SUBSCRIBED", tx_payload(str(uuid.uuid4())), uid=uid)
    assert appstore.apply_notification(st, cfg, jws) == {"status": "unknown_account", "type": "SUBSCRIBED"}
    assert st.subscription("1000") is None
    assert st.mark_event("n:" + uid, "check") is True              # 重複の記録にも残していない
    jws = notification(pki, "SUBSCRIBED", tx_payload(None))
    assert appstore.apply_notification(st, cfg, jws)["status"] == "unknown_account"


@pytest.mark.parametrize("ntype", ["DID_CHANGE_RENEWAL_PREF", "TEST", "PRICE_INCREASE"])
def test_ac_p12_other_notifications_recorded_and_ignored(st, cfg, pki, acc, subscribed, ntype):
    before = st.subscription("1000")
    tx = tx_payload(subscribed, tid="t1", product=PRO, expires=NOW + 90 * DAY)
    uid = str(uuid.uuid4())
    assert appstore.apply_notification(st, cfg, notification(pki, ntype, tx, uid=uid))["status"] == "ignored"
    assert appstore.apply_notification(st, cfg, notification(pki, ntype, tx, uid=uid))["status"] == "duplicate"
    after = st.subscription("1000")
    assert (after["product_id"], after["expires_at"]) == (before["product_id"], before["expires_at"])


@pytest.mark.parametrize("bundle,env", [("com.other.app", "Sandbox"), (BUNDLE, "LocalTesting")])
def test_ac_p10_notification_wrong_bundle_or_env_rejected(st, cfg, pki, acc, subscribed, bundle, env):
    jws = notification(pki, "DID_RENEW", tx_payload(subscribed, tid="t2", expires=NOW + 35 * DAY),
                       bundle=bundle, env=env)
    with pytest.raises(AppStoreVerificationError):
        appstore.apply_notification(st, cfg, jws)
    assert st.subscription("1000")["expires_at"] == pytest.approx(NOW + 5 * DAY, abs=0.01)


def test_ac_p10_notification_inner_transaction_forged_rejected(st, cfg, pki, acc, subscribed):
    """外側の通知は正しく署名されていても、中の取引が偽のチェーンなら拒否する"""
    fake = PKI("Test Root CA")
    data = {"bundleId": BUNDLE, "environment": "Sandbox",
            "signedTransactionInfo": sign(fake, tx_payload(subscribed, tid="t2", expires=NOW + 365 * DAY))}
    jws = sign(pki, {"notificationType": "DID_RENEW", "notificationUUID": str(uuid.uuid4()), "data": data})
    with pytest.raises(AppStoreVerificationError):
        appstore.apply_notification(st, cfg, jws)
    assert st.subscription("1000")["expires_at"] == pytest.approx(NOW + 5 * DAY, abs=0.01)


def test_ac_p10_notification_outer_forged_rejected(st, cfg, acc, subscribed):
    fake = PKI("Test Root CA")
    with pytest.raises(AppStoreVerificationError):
        appstore.apply_notification(st, cfg, notification(fake, "REFUND", tx_payload(subscribed, tid="t1")))
    assert plan_of(st, acc) == "standard"
