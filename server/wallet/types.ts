export type WalletMember = {
  id: string;
  publicToken: string;
  appleAuthToken: string;
  name: string;
  balance: number;
  /** Number of rewards already redeemed; available rewards are derived from the current balance. */
  rewardCount: number;
  updatedAt: string;
  offer?: string;
  voided?: boolean;
};

export type WalletProgram = {
  id: string;
  name: string;
  type: 'stamps' | 'points' | 'coupon';
  rewardThreshold: number;
  rewardName: string;
  color: string;
  description: string;
  tenantName: string;
  logoUrl?: string;
  /** Sanitized RGBA PNG canvas, 320×100 physical pixels (Apple's 2× logo). */
  logoPng?: Buffer;
  expiresAt?: string;
  locations?: Array<{ latitude: number; longitude: number; relevantText?: string }>;
};

export class WalletError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 503,
    public readonly retryable = false,
    public readonly providerStatus?: number,
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

export type WalletStatus = {
  apple: { configured: boolean; missing: string[] };
  google: { configured: boolean; missing: string[] };
};
