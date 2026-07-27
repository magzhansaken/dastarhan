import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'kz.dastarhan.pos',
  appName: 'Dastarhan POS',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  server: {
    // Приложение обращается к нашему API по HTTPS.
    // Без этого списка Android блокирует запросы к внешним доменам.
    allowNavigation: [
      'dastarhan.duckdns.org',
      '*.dastarhan.kz',
    ],
    androidScheme: 'https',
  },
  plugins: {
    CapacitorSQLite: { androidIsEncryption: false },
  },
};

export default config;
