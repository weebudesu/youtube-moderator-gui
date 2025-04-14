// pages/api/auth/[...nextauth].ts
import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required.");
}
if (!process.env.NEXTAUTH_SECRET) {
    throw new Error("NEXTAUTH_SECRET environment variable is required.");
}


export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          // Minta izin yang diperlukan (termasuk offline access untuk refresh token)
          scope: "openid email profile https://www.googleapis.com/auth/youtube.force-ssl",
          access_type: "offline", // Penting untuk mendapatkan refresh token
          prompt: "consent", // Selalu minta persetujuan untuk memastikan refresh token diberikan
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    // Menyimpan access token dan refresh token ke dalam JWT
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token; // Simpan refresh token
        token.expiresAt = account.expires_at; // Simpan waktu kedaluwarsa
      }

      // Cek apakah access token masih valid
      // Waktu dalam detik, Date.now() dalam milidetik
      if (token.expiresAt && Date.now() < token.expiresAt * 1000) {
        return token;
      }

      // Jika access token kedaluwarsa dan ada refresh token, coba refresh
      if (token.refreshToken) {
          console.log("Refreshing access token...");
          try {
              const response = await fetch("https://oauth2.googleapis.com/token", {
                  method: "POST",
                  headers: {
                      "Content-Type": "application/x-www-form-urlencoded",
                  },
                  body: new URLSearchParams({
                      client_id: process.env.GOOGLE_CLIENT_ID!,
                      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
                      grant_type: "refresh_token",
                      refresh_token: token.refreshToken as string,
                  }),
              });

              const refreshedTokens = await response.json();

              if (!response.ok) {
                  throw refreshedTokens;
              }

              console.log("Access token refreshed!");
              return {
                  ...token,
                  accessToken: refreshedTokens.access_token,
                  expiresAt: Math.floor(Date.now() / 1000 + refreshedTokens.expires_in),
                  // Refresh token mungkin juga dikembalikan, simpan jika berubah
                  refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
              };
          } catch (error) {
              console.error("Error refreshing access token", error);
              // Jika refresh gagal, hapus token lama agar user login ulang
              return { ...token, error: "RefreshAccessTokenError", accessToken: undefined, refreshToken: undefined, expiresAt: undefined };
          }
      }


      return token;
    },
    // Menyimpan access token ke dalam session agar bisa diakses di client (jika perlu)
    // Hati-hati! Hanya simpan data yang aman untuk diekspos ke client.
    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined; // Cast ke string atau undefined
      session.error = token.error as string | undefined; // Propagasi error ke session
      // Jangan ekspos refresh token ke client!
      return session;
    },
  },
};

export default NextAuth(authOptions);