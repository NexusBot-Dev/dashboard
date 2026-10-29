/// <reference types="astro/client" />
declare module '@fontsource-variable/*';

declare namespace App {
  interface Locals {
    session: import('./lib/session').SessionData;
    lang: import('./i18n').Lang;
    t: (key: string, vars?: Record<string, string | number>) => string;
  }
}