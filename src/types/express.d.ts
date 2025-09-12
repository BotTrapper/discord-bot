// Type extensions for Express and Passport
declare global {
  namespace Express {
    interface User {
      id: string;
      username?: string;
      discriminator?: string;
      avatar?: string | null;
      guilds?: any[];
      accessToken?: string;
      refreshToken?: string;
      isGlobalAdmin?: boolean;
      adminLevel?: number;
    }

    interface Request {
      user?: User;
      logout(callback?: (err: any) => void): void;
      logOut(callback?: (err: any) => void): void;
      isAuthenticated(): boolean;
      isUnauthenticated(): boolean;
    }
  }
}

export {};