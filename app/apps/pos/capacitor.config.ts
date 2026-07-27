import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'kz.dastarhan.pos',
  appName: 'Dastarhan POS',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: {
    CapacitorSQLite: { androidIsEncryption: false }, // локальная БД кассы
  },
};
export default config;
