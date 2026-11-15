import WaveQRLogin from '../Model/WavsQRLoginModel.js';
import { UserDatabase } from '../Model/WavsQRUserDatabase.js';

import fs from 'node:fs';
import { readWavsQRConfig } from '../Model/WavsQRConfig.js';
const verificationMap = new Map();
const uid = new Map();

export class WaveQRLogins extends plugin {
  constructor() {
    super({
      name: '鸣潮游戏登录',
      event: 'message',
      priority: Number.MIN_SAFE_INTEGER,
      rule: [
        {
          reg: /^(～|ww|~|鸣潮)(游戏)?(确认登录|验证|授权登录)(.*)$/i,
          fnc: 'QRLogin',
        },
      ],
    });
  }

  async QRLogin() {
    return Wave_Login(this.e);
  }
}

async function getimageUrl(e) {
  let imageUrl = e.img?.[0];
  if (!imageUrl && e.getReply) {
    if (e.bot?.adapter?.id !== 'QQ') return null;
    const response = await e.getReply();
    const msgObj = JSON.parse(
      JSON.stringify(response, (key, value) => {
        if (typeof value === 'bigint') {
          return value.toString() + 'n';
        }
        return value;
      })
    );
    const imageMessage = msgObj.message.find((item) => item.type === 'image');
    if (imageMessage) {
      imageUrl = imageMessage.url;
    }
  }
  return imageUrl || null;
}

async function Wave_Login(e) {
  let reg = /^(～|ww|~|鸣潮)(游戏)?验证(\d+)$/i.exec(e.msg);
  if (reg && reg[3]) {
    const verifyCode = reg[3];
    await verify(e, verifyCode);
  } else {
    reg = /^(～|ww|~|鸣潮)(游戏)?(确认登录|授权登录)(\d+)$/i.exec(e.msg);
    const dbPath = readWavsQRConfig().databasePath;
    if (!dbPath) return await e.reply('请先在锅巴配置鸣潮 GsData.db 路径', true);
    if (!fs.existsSync(dbPath)) return await e.reply(`未找到鸣潮数据库：${dbPath}`, true);
    const userDB = new UserDatabase(dbPath);
    const url = await getimageUrl(e);
    if (!url) return await e.reply('请同时携带二维码图片使用该指令', true);
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (reg && reg[4]) {
      const data = (await userDB.getUserByUid(String(reg[4])))?.[0] || {};
      if (e.isMaster || String(data.user_id) === String(e.user_id)) {
        return await QRLogin(e, data, buffer);
      }
      return e.reply('未登录鸣潮，使用示例指令【ww登录】后再试...', true);
    } else {
      const userData = await userDB.getUserByUserId(String(e.user_id));
      const validUserData = userData.filter(account => account.uid && String(account.uid).length === 9);
      if (validUserData.length === 0) return e.reply('未登录鸣潮，使用示例指令【ww登录】后再试...', true);
      if (validUserData.length > 1) {
        let replyMessage = `当前绑定 ${validUserData.length} 个账号\n请使用对应的确认指令完成登录：\n`;
        validUserData.forEach((account, index) => {
          replyMessage += `\n账号${index + 1} (UID: ${account.uid})：\n【ww确认登录${account.uid}】`;
        });
        await e.reply(replyMessage, true);
      } else {
        let data = validUserData[0];
        await QRLogin(e, data, buffer);
      }
    }
  }
}

async function QRLogin(e, data, buffer) {
  try {
    const qrLogin = new WaveQRLogin(data.cookie, { device_id: data.did });
    const result = await qrLogin.login(buffer);
    if (result.succeed) {
      return await e.reply(`登录成功！\n游戏UID: ${data.uid}\n授权应用: 鸣潮`, true);
    } else {
      if (result.needVerification && result.storageKey) {
        await e.reply('本次授权登录需要进行二维码验证，验证码已发出!\n请使用指令【ww验证123456】完成验证', true);
        verificationMap.set(e.user_id, result.storageKey);
        uid.set(result.storageKey, data.uid);
        return true;
      }
      return await e.reply('授权登录失败，未知错误，请联系主人...', true);
    }
  } catch (error) {
    logger.error(error);
    await e.reply(error.message, true);
  }
}

async function verify(e, verifyCode) {
  try {
    if (!verificationMap.has(e.user_id)) return await e.reply('你无需进行验证，请直接使用【ww确认登录】完成登录操作', true);
    const storageKey = verificationMap.get(e.user_id);
    const qrLogin = new WaveQRLogin();
    const result = await qrLogin.Verification(storageKey, verifyCode);
    if (result.succeed) {
      return await e.reply(`登录成功!\n游戏UID: ${uid.get(storageKey)}\n授权应用: 鸣潮`, true);
    } else {
      return await e.reply(result.data.msg, true);
    }
  } catch (error) {
    await e.reply(error.message, true);
  }
}
