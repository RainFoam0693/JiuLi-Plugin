import crypto from 'crypto';
import QRCodeParser from './WavsQRParser.js';





const parser = new QRCodeParser();
const Getdistinct_id = (id) => (id || crypto.randomUUID()).toLowerCase();
const verificationMap = new Map();

async function postForm(url, data, headers) {
  const response = await fetch(url, { method: 'POST', headers, body: new URLSearchParams(data) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { data: await response.json() };
}

class WaveQRLogin {
  /**
   * 初始化登录器
   * @param {string} token - 用户token
   * @param {object} [options] - 配置选项
   * @param {string} [options.device_id] - 设备ID
   * @param {string} [options.devCode] - 设备代码
   * @param {string} [options.ip] - IP地址
   */
  constructor(token, options = {}) {
    this.distinct_id = Getdistinct_id(options.device_id);
    this.config = {
      device_id: this.distinct_id,
      headers: {
        devCode: options.devCode || crypto.randomBytes(20).toString('hex').toUpperCase(),
        ip: options.ip || '192.168.31.236',
        source: 'android',
        version: '2.5.0',
        versionCode: '2500',
        token: token,
        osVersion: '33',
        distinct_id: this.distinct_id,
        countryCode: 'CN',
        model: 'Redmi K20 Pro',
        lang: 'zh-Hans',
        channelId: '4',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'okhttp/3.11.0',
        Cookie: `user_token=${token}; `,
      },
    };
  }

  /**
   * 解析二维码图片
   * @param {string|Buffer} imagePath - 图片Buffer
   * @returns {Promise<string|null>} - 二维码数据或null
   */
  async _parseQRCode(imagePath) {
    try {
      const code = await parser.parse(imagePath);
      if (!code?.data) throw new Error(code?.msg || '未能从图片识别二维码');
      return code.data;
    } catch (error) {
      throw new Error(`识别二维码失败: ${error.message}`);
    }
  }

  /**
   * 请求角色信息
   * @param {string} qrCode - 二维码数据
   * @returns {Promise<object>}
   */
  async requestRoleInfos(qrCode) {
    const url = 'https://api.kurobbs.com/user/auth/roleInfos';
    try {
      const response = await postForm(url, { qrCode }, this.config.headers);
      return response.data;
    } catch (error) {
      throw new Error(error.message);
    }
  }

  /**
   * 发送扫码登录请求
   * @param {string} qrCode - 二维码数据
   * @param {string} [verifyCode] - 验证码
   * @returns {Promise<object>}
   */
  async sendScanLogin(qrCode, verifyCode = '') {
    const url = 'https://api.kurobbs.com/user/auth/scanLogin';
    const data = {
      autoLogin: 'true',
      qrCode,
      id: '',
      verifyCode,
    };
    try {
      const response = await postForm(url, data, this.config.headers);
      return response.data;
    } catch (error) {
      throw new Error(error.message);
    }
  }

  /**
   * 请求短信验证码
   * @returns {Promise<object>}
   */
  async requestSmsVerification() {
    const url = 'https://api.kurobbs.com/user/sms/scanSms';
    try {
      const response = await postForm(url, { geetTestData: '' }, this.config.headers);
      return response.data;
    } catch (error) {
      throw new Error(`请求验证码失败: ${error.message}`);
    }
  }

  /**
   * 通过存储的key触发验证
   * @param {string} storageKey - 存储时返回的key，格式应为 verify_${distinct_id}_${timestamp}
   * @param {string} verifyCode - 验证码
   * @throws {Error} 当验证请求无效、已过期或超时时抛出错误
   */
  async Verification(storageKey, verifyCode) {
    if (!verificationMap.has(storageKey)) throw new Error('你暂无验证码');
    const parts = storageKey.split('_');
    const timestamp = parseInt(parts[2]);
    if (isNaN(timestamp)) {
      verificationMap.delete(storageKey);
      throw new Error('验证请求已超时，请重新尝试快捷登录');
    }

    const currentTime = Date.now();
    if (currentTime - timestamp > 60000) {
      verificationMap.delete(storageKey);
      throw new Error('验证请求已超时，请重新尝试快捷登录');
    }

    try {
      const handler = verificationMap.get(storageKey);
      const result = await handler(verifyCode);
      return result;
    } finally {
      verificationMap.delete(storageKey);
    }
  }

  /**
   * 执行登录流程
   * @param {string|Buffer} qrImage - 二维码图片
   * @returns {Promise<{
   *   succeed: boolean,
   *   data?: object,
   *   needVerification?: boolean,
   *   handleVerification?: (verifyCode: string) => Promise<{ succeed: boolean, data?: object }>
   * }>}
   */
  async login(qrImage) {
    const qrData = await this._parseQRCode(qrImage);
    if (!qrData?.includes('#')) throw new Error('无效的二维码内容');
    const roleInfo = await this.requestRoleInfos(qrData);
    if (roleInfo.code !== 200) {
      logger.warn(
        JSON.stringify(
          roleInfo,
          (key, value) => {
            if (typeof value === 'bigint') {
              return value.toString() + 'n';
            }
            return value;
          },
          2
        )
      );
      throw new Error(roleInfo.msg || '二维码已过期...');
    }
    const loginResult = await this.sendScanLogin(qrData);

    if (loginResult.code === 200) {
      return {
        succeed: true,
        data: loginResult,
      };
    }

    if (loginResult.code === 2240) {
      await this.requestSmsVerification();
      const storageKey = `verify_${this.distinct_id}_${Date.now()}`;
      const handleVerification = async (verifyCode) => {
        const result = await this.sendScanLogin(qrData, verifyCode);
        return {
          succeed: result.code === 200,
          data: result,
        };
      };
      verificationMap.set(storageKey, handleVerification);
      return {
        succeed: false,
        needVerification: true,
        storageKey,
      };
    }
    logger.warn(
      JSON.stringify(
        loginResult,
        (key, value) => {
          if (typeof value === 'bigint') {
            return value.toString() + 'n';
          }
          return value;
        },
        2
      )
    );
    throw new Error(loginResult.msg || '登录失败：未知错误');
  }
}

export default WaveQRLogin;
