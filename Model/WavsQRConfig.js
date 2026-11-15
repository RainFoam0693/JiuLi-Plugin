import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const directory = path.dirname(fileURLToPath(import.meta.url));
export const wavsQRConfigPath = path.resolve(directory, '../config/WavsQRLogin.yaml');
const defaultConfig = { databasePath: '/Users/chuzu/Desktop/gsuid_core/data/GsData.db' };

export function readWavsQRConfig() {
  if (!fs.existsSync(wavsQRConfigPath)) return { ...defaultConfig };
  const value = parse(fs.readFileSync(wavsQRConfigPath, 'utf8'));
  return { ...defaultConfig, ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}) };
}

export function saveWavsQRConfig(value) {
  if (!value || typeof value.databasePath !== 'string') throw new Error('GsData.db 路径必须是文本');
  const config = { ...readWavsQRConfig(), databasePath: value.databasePath.trim() };
  fs.mkdirSync(path.dirname(wavsQRConfigPath), { recursive: true });
  const temporary = `${wavsQRConfigPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, stringify(config), { mode: 0o600 });
  fs.renameSync(temporary, wavsQRConfigPath);
  return config;
}
