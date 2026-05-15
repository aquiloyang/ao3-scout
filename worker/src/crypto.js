function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export async function encrypt(plaintext, masterKey) {
  const key = await crypto.subtle.importKey(
    'raw', hexToBytes(masterKey), { name: 'AES-GCM' }, false, ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)
  );
  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...combined));
}

export async function decrypt(encrypted, masterKey) {
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw', hexToBytes(masterKey), { name: 'AES-GCM' }, false, ['decrypt']
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12)
  );
  return new TextDecoder().decode(plaintext);
}

const JWT_EXPIRY = 30 * 24 * 60 * 60;

function b64url(obj) {
  return btoa(JSON.stringify(obj))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export async function signJWT(payload, secret) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + JWT_EXPIRY };
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(claims);
  const input = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${input}.${sigB64}`;
}

export async function verifyJWT(token, secret) {
  try {
    const [header, payload, sig] = token.split('.');
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(
      atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key, sigBytes, new TextEncoder().encode(`${header}.${payload}`)
    );
    if (!valid) return null;
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function authenticate(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return verifyJWT(auth.slice(7), env.JWT_SECRET);
}
