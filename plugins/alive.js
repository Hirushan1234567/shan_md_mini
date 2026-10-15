export default {
  command: "alive",

  async execute(sock, msg) {
    const jid = msg.key.remoteJid;

    const fs = await import("fs");

    const text = `
╭━━━〔 👑 SHAN MINI BOT 〕━━━╮
┃
┃   🟢 STATUS  : ONLINE
┃   ⚡ SYSTEM  : ACTIVE
┃   🚀 VERSION : V1
┃
┃   💫 I'm alive & ready!
┃
╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯
`;

    if (fs.existsSync("./logo.jpg")) {
      await sock.sendMessage(
        jid,
        {
          image: fs.readFileSync("./logo.jpg"),
          caption: text
        },
        { quoted: msg }
      );
    } else {
      await sock.sendMessage(
        jid,
        {
          text
        },
        { quoted: msg }
      );
    }
  }
};