const React = require('react');
const ReactDOMServer = require('react-dom/server');
const sharp = require('sharp');
const md = require('react-icons/md');

const icons = {
  music: md.MdMusicNote,
  article: md.MdArticle,
  phone: md.MdSmartphone,
  sparkle: md.MdAutoAwesome,
  pause: md.MdPauseCircle,
  check: md.MdCheckCircle,
  trend: md.MdTrendingUp,
  schedule: md.MdSchedule,
  robot: md.MdSmartToy,
  money: md.MdPaid,
  org: md.MdAccountTree,
  web: md.MdLanguage,
  seo: md.MdSearch,
  warn: md.MdErrorOutline,
  send: md.MdSend,
  build: md.MdBuild,
  lock: md.MdLock,
  arrow: md.MdArrowForward,
  calendar: md.MdCalendarMonth,
};

async function main() {
  for (const [name, Icon] of Object.entries(icons)) {
    const svg = ReactDOMServer.renderToStaticMarkup(
      React.createElement(Icon, { size: 512, color: '#FFFFFF' })
    );
    await sharp(Buffer.from(svg), { density: 384 }).resize(256, 256).png().toFile(`${__dirname}/icons/${name}.png`);
    console.log('made', name);
  }
}
main();
