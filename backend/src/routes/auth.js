import express from 'express';
import { google } from 'googleapis';
import { encryptToken, decryptToken } from '../services/encryption.js';

const router = express.Router();

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Step 1: Redirect user to Google consent screen
router.get('/google', (req, res) => {
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force refresh token every time
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
  });
  res.redirect(url);
});

// Step 2: Google redirects back here with a code
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`${process.env.FRONTEND_URL}/?error=access_denied`);
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    // Get user info
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    // Store encrypted tokens in session
    req.session.user = {
      id: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      accessToken: encryptToken(tokens.access_token),
      refreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      tokenExpiry: tokens.expiry_date,
      provider: 'gmail',
    };

    res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL}/?error=auth_failed`);
  }
});

// Get current user
router.get('/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { accessToken, refreshToken, ...safeUser } = req.session.user;
  res.json(safeUser);
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

export default router;
