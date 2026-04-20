import type { NextConfig } from 'next';
const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@foundry/auth', '@foundry/db', '@foundry/ui'],
};
export default config;
