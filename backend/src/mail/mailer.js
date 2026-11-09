// Sending e-mail (SMTP, through nodemailer): password links today. Off until set:
//   MAIL_URL   the SMTP server, e.g. smtps://user:password@smtp.example.com:465 (Amazon SES, Mailgun,
//              Google Workspace… all give one); 'json' keeps messages in memory (tests)
//   MAIL_FROM  who it comes from, e.g. "SubSaleKing <no-reply@subsaleking.com>"
//   ERP_URL    the ERP's own address, e.g. https://erp.subsaleking.com/ — links in e-mails are built from
//              it, never from the request (a link someone else chose must never reach a person's inbox)
const nodemailer = require('nodemailer');

let transport = null, made = null;
const sent = [];
function transportFor() {
  const url = process.env.MAIL_URL;
  if (!url) return null;
  if (made !== url) {
    transport = url === 'json' ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport(url);
    made = url;
  }
  return transport;
}
const enabled = () => !!process.env.MAIL_URL && !!process.env.ERP_URL;
const erpUrl = () => String(process.env.ERP_URL || '').replace(/#.*$/, '');

async function sendMail({ to, subject, text }) {
  const t = transportFor();
  if (!t) throw new Error('E-mail is not set up (MAIL_URL).');
  const info = await t.sendMail({ from: process.env.MAIL_FROM || 'SubSaleKing <no-reply@subsaleking.com>', to, subject, text });
  if (process.env.MAIL_URL === 'json') sent.push(JSON.parse(info.message));
  return info;
}

module.exports = { enabled, sendMail, erpUrl, sent };
