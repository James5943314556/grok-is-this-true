const X_CREATE_POST_URL = "https://api.x.com/2/tweets";

const AUTH_CONFIG_KEY = "xAuthConfig";
const AUTH_METHOD_OAUTH1 = "oauth1";

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  void routeMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : "Request failed."
      })
    );

  return true;
});

async function routeMessage(message) {
  switch (message.type) {
    case "X_AUTH_STATUS":
      return buildAuthStatusResponse();
    case "X_AUTH_SAVE_OAUTH1":
      return handleAuthSaveOauth1(message.payload);
    case "X_AUTH_LOGOUT":
      return handleAuthLogout();
    case "X_REPLY_TO_TWEET":
      return handleReplyToTweet(message.payload);
    default:
      return {
        ok: false,
        message: "Unsupported message."
      };
  }
}

async function handleAuthSaveOauth1(payload) {
  const config = sanitizeAuthConfig(payload);
  if (!hasOauth1Credentials(config)) {
    throw new Error("Enter your consumer key, consumer secret, access token, and access token secret.");
  }

  await writeAuthConfig(config);
  return buildAuthStatusResponse();
}

async function handleAuthLogout() {
  await writeAuthConfig(createEmptyAuthConfig());
  return buildAuthStatusResponse();
}

async function handleReplyToTweet(payload) {
  const tweetId = sanitizeTweetId(payload?.tweetId);
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!tweetId) {
    throw new Error("No target tweet ID was provided.");
  }

  if (!text) {
    throw new Error("Reply text cannot be empty.");
  }

  const config = await readAuthConfig();
  if (!hasOauth1Credentials(config)) {
    throw new Error("Save your local OAuth 1.0a keys before sending replies.");
  }

  const response = await fetch(X_CREATE_POST_URL, {
    method: "POST",
    headers: {
      Authorization: await buildOauth1AuthorizationHeader({
        method: "POST",
        url: X_CREATE_POST_URL,
        consumerKey: config.oauth1ConsumerKey,
        consumerSecret: config.oauth1ConsumerSecret,
        token: config.oauth1AccessToken,
        tokenSecret: config.oauth1AccessTokenSecret
      }),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      reply: {
        in_reply_to_tweet_id: tweetId
      }
    })
  });

  const data = await parseJsonSafely(response);
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        extractApiError(data) ||
          "X returned 401 Unauthorized for posting. Recheck your consumer key, consumer secret, access token, and access token secret."
      );
    }

    if (response.status === 403) {
      throw new Error(
        extractApiError(data) ||
          "X forbids this post request. Check app permissions, credits, and read/write access."
      );
    }

    throw new Error(extractApiError(data) || "X rejected the reply request.");
  }

  return {
    ok: true,
    data: data?.data || null
  };
}

async function buildAuthStatusResponse() {
  const config = await readAuthConfig();
  const connected = hasOauth1Credentials(config);

  return {
    ok: true,
    configured: connected,
    connected,
    authMethod: connected ? AUTH_METHOD_OAUTH1 : "",
    profile: connected ? buildOauth1Profile(config) : null
  };
}

async function ensureDefaults() {
  const config = await readAuthConfig();
  if (!config) {
    await writeAuthConfig(createEmptyAuthConfig());
  }
}

async function readAuthConfig() {
  const result = await chrome.storage.local.get(AUTH_CONFIG_KEY);
  return {
    ...createEmptyAuthConfig(),
    ...(result[AUTH_CONFIG_KEY] || {})
  };
}

async function writeAuthConfig(config) {
  const nextConfig = sanitizeAuthConfig({
    ...createEmptyAuthConfig(),
    ...(config || {})
  });

  await chrome.storage.local.set({
    [AUTH_CONFIG_KEY]: nextConfig
  });
}

function createEmptyAuthConfig() {
  return {
    oauth1ConsumerKey: "",
    oauth1ConsumerSecret: "",
    oauth1AccessToken: "",
    oauth1AccessTokenSecret: "",
    oauth1ScreenName: ""
  };
}

function sanitizeAuthConfig(config) {
  return {
    oauth1ConsumerKey: sanitizeCredential(config?.oauth1ConsumerKey ?? config?.consumerKey),
    oauth1ConsumerSecret: sanitizeCredential(config?.oauth1ConsumerSecret ?? config?.consumerSecret),
    oauth1AccessToken: sanitizeCredential(config?.oauth1AccessToken ?? config?.accessToken),
    oauth1AccessTokenSecret: sanitizeCredential(
      config?.oauth1AccessTokenSecret ?? config?.accessTokenSecret
    ),
    oauth1ScreenName: sanitizeScreenName(config?.oauth1ScreenName ?? config?.screenName)
  };
}

function hasOauth1Credentials(config) {
  return Boolean(
    sanitizeCredential(config?.oauth1ConsumerKey) &&
      sanitizeCredential(config?.oauth1ConsumerSecret) &&
      sanitizeCredential(config?.oauth1AccessToken) &&
      sanitizeCredential(config?.oauth1AccessTokenSecret)
  );
}

function buildOauth1Profile(config) {
  const screenName = sanitizeScreenName(config?.oauth1ScreenName);
  return screenName ? { username: screenName } : { name: "local OAuth 1.0a keys" };
}

function sanitizeCredential(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeScreenName(value) {
  return typeof value === "string" ? value.trim().replace(/^@+/, "") : "";
}

function sanitizeTweetId(value) {
  return typeof value === "string" && /^\d+$/.test(value) ? value : "";
}

async function buildOauth1AuthorizationHeader({
  method,
  url,
  consumerKey,
  consumerSecret,
  token,
  tokenSecret
}) {
  const target = new URL(url);
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: randomHex(32),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: "1.0"
  };

  const signatureParams = [];
  for (const [key, value] of Object.entries(oauthParams)) {
    signatureParams.push([key, value]);
  }
  for (const [key, value] of target.searchParams.entries()) {
    signatureParams.push([key, value]);
  }

  const normalizedParams = signatureParams
    .map(([key, value]) => [percentEncode(key), percentEncode(value)])
    .sort((a, b) => {
      if (a[0] === b[0]) {
        return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
      }

      return a[0] < b[0] ? -1 : 1;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(`${target.origin}${target.pathname}`),
    percentEncode(normalizedParams)
  ].join("&");
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const signature = await hmacSha1Base64(signingKey, baseString);

  const headerParams = {
    ...oauthParams,
    oauth_signature: signature
  };

  return `OAuth ${Object.entries(headerParams)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
    .join(", ")}`;
}

async function hmacSha1Base64(key, value) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    {
      name: "HMAC",
      hash: "SHA-1"
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(signature));
}

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function randomHex(length) {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, length);
}

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function extractApiError(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.error_description === "string") {
    return payload.error_description;
  }

  if (typeof payload.detail === "string") {
    return payload.detail;
  }

  if (Array.isArray(payload.errors) && payload.errors.length) {
    return payload.errors.map((item) => item.detail || item.message).filter(Boolean).join("; ");
  }

  if (typeof payload.title === "string") {
    return payload.title;
  }

  return "";
}
