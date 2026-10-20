
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

app.get("/api/buscar", async (req, res) => {
  try {
    const termo = String(req.query.q || "").trim();

    if (!termo) {
      return res.status(400).json({
        erro: "Digite um produto para pesquisar."
      });
    }

    const url = new URL("https://api.mercadolibre.com/sites/MLB/search");
    url.searchParams.set("q", termo);
    url.searchParams.set("limit", "24");

    const resposta = await fetch(url);

    if (!resposta.ok) {
      return res.status(resposta.status).json({
        erro: "A API do Mercado Livre não conseguiu atender à busca."
      });
    }

    const dados = await resposta.json();

    const produtos = (dados.results || []).map(p => ({
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
      total: dados.paging?.total || produtos.length,
      produtos
    });
  } catch (erro) {
    console.error("Erro na busca:", erro.message);

    res.status(500).json({
      erro: "Não foi possível consultar os produtos."
    });
  }
});

app.get("/api/status", (req, res) => {
  res.json({ funcionando: true });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
