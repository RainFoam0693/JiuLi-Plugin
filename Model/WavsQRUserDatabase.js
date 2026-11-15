import sqlite3 from 'sqlite3';

export class UserDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
  }

  /**
   * 通过 ltuid 精确查询 Users 表中的用户 id
   * @param {string|number} ltuid - 要查询的 ltuid
   * @returns {Promise<Array>} 包含匹配记录的数组
   */
  async getIdByLtuid(ltuid) {
    const db = this.#getReadonlyConnection();
    try {
      return await new Promise((resolve, reject) => {
        // 使用精确匹配：ltuids 可以是以下情况之一：
        // 1. 完全等于 ltuid（如 "123"）
        // 2. 以 ltuid 开头，后跟逗号（如 "123,456"）
        // 3. 包含逗号 + ltuid + 逗号（如 "456,123,789"）
        // 4. 以逗号 + ltuid 结尾（如 "456,123"）
        db.all(
          `SELECT id FROM Users WHERE
         ltuids = ? OR
         ltuids LIKE ? OR
         ltuids LIKE ? OR
         ltuids LIKE ?`,
          [ltuid.toString(), `${ltuid}`, `${ltuid},%`, `%,${ltuid}`],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
    } finally {
      db.close();
    }
  }

  /**
   * 获取数据库连接（只读）
   */
  #getReadonlyConnection() {
    return new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY);
  }

  /**
   * 通过 user_id 查询用户
   */
  async getUserByUserId(userId) {
    const db = this.#getReadonlyConnection();
    try {
      return await new Promise((resolve, reject) => {
        db.all(`SELECT user_id, cookie, uid, did, record_id, status, platform FROM wavesuser WHERE user_id = ?`, [userId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    } finally {
      db.close();
    }
  }

  /**
   * 通过 UID 查询用户
   */
  async getUserByUid(uid) {
    const db = this.#getReadonlyConnection();
    try {
      return await new Promise((resolve, reject) => {
        db.all(`SELECT * FROM wavesuser WHERE uid = ?`, [uid], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    } finally {
      db.close();
    }
  }

  /**
   * 批量查询用户（模糊匹配）
   */
  async queryUsersByPrefix(prefix) {
    const db = this.#getReadonlyConnection();
    try {
      return await new Promise((resolve, reject) => {
        db.all(`SELECT * FROM wavesuser WHERE user_id LIKE ? || '%'`, [prefix], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    } finally {
      db.close();
    }
  }
}
