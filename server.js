
const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.ML_CLIENT_ID;
const CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
const REDIRECT_URI = "https://robo-achados.onrender.com/callback";

const SITE_URL = "https://api.mercadolibre.com";
const AUTH_URL = "https://auth.mercadolivre.com.br/authorization";

let tokens = null;
let tokenExpiry = 0;
const pendingLogins = new Map();

app.use(express.static("public"));

function base64url(buffer) {
  return buffer.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createVerifier() {
  return base64url(crypto.randomBytes(32));
}

function createChallenge(verifier) {
  return base64url(
    crypto.createHash("sha256").update(verifier).digest()
  );
}

async function requestToken(params) {
  const response = await fetch(`${SITE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams(params)
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Falha OAuth:", response.status, data.error);
    throw new Error(`OAuth falhou (HTTP ${response.status}).`);
  }

  return data;
}

async function refreshAccessToken() {
  if (!tokens?.refresh_token) {
    throw new Error("Autorização necessária. Acesse /login.");
  }

  const data = await requestToken({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: tokens.refresh_token
  });

  tokens = data;
  tokenExpiry = Date.now() + (data.expires_in * 1000);
}

async function getAccessToken() {
  if (!tokens?.access_token) {
    throw new Error("Autorização necessária. Acesse /login.");
  }

  if (Date.now() >= tokenExpiry - 60000) {
    await refreshAccessToken();
  }

  return tokens.access_token;
}

app.get("/api/status", (req, res) => {
  res.json({
    funcionando: true,
    autorizado: Boolean(tokens?.access_token)
  });
});

app.get("/login", (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).send(
      "Configure ML_CLIENT_ID e ML_CLIENT_SECRET no Render."
    );
  }

  const state = base64url(crypto.randomBytes(24));
  const verifier = createVerifier();

  pendingLogins.set(state, {
    verifier,
    createdAt: Date.now()
  });

  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", createChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");

  res.redirect(url.toString());
});

app.get("/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).send(
        "O Mercado Livre não autorizou o aplicativo. Tente /login novamente."
      );
    }

    const login = pendingLogins.get(state);
    pendingLogins.delete(state);

    if (!code || !login ||
        Date.now() - login.createdAt > 10 * 60 * 1000) {
      return res.status(400).send(
        "Autorização inválida ou expirada. Acesse /login novamente."
      );
    }

    const data = await requestToken({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: String(code),
      redirect_uri: REDIRECT_URI,
      code_verifier: login.verifier
    });

    tokens = data;
    tokenExpiry = Date.now() + (data.expires_in * 1000);

    res.send(`
      <!doctype html>
      <html lang="pt-BR">
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Robô Achados</title>
      <body style="font-family:Arial;padding:24px">
        <h2>Autorização concluída!</h2>
        <p>O Mercado Livre autorizou a conexão nesta sessão.</p>
        <p><a href="/">Voltar ao Robô Achados</a></p>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Erro no callback:", err.message);
    res.status(500).send(
      "Não foi possível concluir a autorização. Confira os logs do Render."
    );
  }
});

app.get("/api/buscar", async (req, res) => {
  try {
    const termo = String(req.query.q || "").trim();

    if (!termo) {
      return res.status(400).json({
        erro: "Digite um produto para pesquisar."
      });
    }

    const accessToken = await getAccessToken();
    const url = new URL(`${SITE_URL}/sites/MLB/search`);
    url.searchParams.set("q", termo);
    url.searchParams.set("limit", "24");

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Erro na busca:", response.status, data.error);
      return res.status(response.status).json({
        erro: "Erro do Mercado Livre",
        status: response.status,
        detalhe: data.message || data.error || "Consulta recusada"
      });
    }

    const produtos = (data.results || []).map(p => ({
      id: p.id,
      title: p.title,
      price: p.price,
      currency_id: p.currency_id,
      thumbnail: p.thumbnail,
      permalink: p.permalink,
      condition: p.condition,
      available_quantity: p.available_quantity,
      sold_quantity: p.sold_quantity
    }));

    res.json({
      total: data.paging?.total || produtos.length,
      produtos
    });
  } catch (err) {
    console.error("Erro na busca:", err.message);
    res.status(500).json({ erro: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
