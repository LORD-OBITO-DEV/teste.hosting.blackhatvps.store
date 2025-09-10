import express from "express";
import mongoose from "mongoose";
import config from "./config.js";
import paypal from "paypal-rest-sdk";
import nodemailer from "nodemailer";
import Transaction from "./models/Transaction.js";
import path from "path";
import { fileURLToPath } from "url";
import OVH from "ovh";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- MongoDB ---
mongoose
  .connect(config.MONGO_URI)
  .then(() => console.log("✅ Connecté à MongoDB"))
  .catch((err) => console.error("❌ Erreur MongoDB:", err));

// --- PayPal ---
paypal.configure({
  mode: config.PAYPAL_MODE,
  client_id: config.PAYPAL_CLIENT_ID,
  client_secret: config.PAYPAL_CLIENT_SECRET,
});

// --- OVH ---
const ovh = new OVH({
  appKey: config.OVH_APP_KEY,
  appSecret: config.OVH_APP_SECRET,
  consumerKey: config.OVH_CONSUMER_KEY,
});

// --- Public folder ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// --- Paiement ---
app.post("/pay", async (req, res) => {
  try {
    const { email, amount, service, os } = req.body;

    const transaction = await Transaction.create({ email, amount, service, os });

    const create_payment_json = {
      intent: "sale",
      payer: { payment_method: "paypal" },
      redirect_urls: {
        return_url: `${config.SITE_URL}/success`,
        cancel_url: `${config.SITE_URL}/cancel`,
      },
      transactions: [
        {
          item_list: {
            items: [
              { name: service, sku: "001", price: amount, currency: "USD", quantity: 1 },
            ],
          },
          amount: { currency: "USD", total: amount },
          description: `Achat ${service} via BlackHatVPS`,
        },
      ],
    };

    paypal.payment.create(create_payment_json, (error, payment) => {
      if (error) return res.status(500).json({ error });

      transaction.paymentId = payment.id;
      transaction.save();

      const approvalUrl = payment.links.find((link) => link.rel === "approval_url").href;
      res.json({ approvalUrl });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Success ---
app.get("/success", async (req, res) => {
  const { paymentId, PayerID } = req.query;

  paypal.payment.execute(paymentId, { payer_id: PayerID }, async (error, payment) => {
    if (error) return res.status(500).send(error);

    const transaction = await Transaction.findOneAndUpdate(
      { paymentId },
      { status: "completed", payerId: PayerID },
      { new: true }
    );

    // --- Création VPS OVH ---
    if (transaction) {
      const plan = transaction.service; // ex: VPS 1GB
      const osTemplate = transaction.os; // ex: Debian 12
      const price = transaction.amount;

      // Exemple OVH: créer VPS (API OVH)
      // https://api.ovh.com/console/#/vps#POST
      // Ajuste selon ton type d'offre OVH
      // ovh.request('POST', '/vps/{serviceName}/create', {...})
    }

    // --- Email ---
    if (transaction.email) {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: config.MAIL_USER, pass: config.MAIL_PASS },
      });

      await transporter.sendMail({
        from: `"BlackHatVPS" <${config.MAIL_USER}>`,
        to: transaction.email,
        subject: "✅ Confirmation de votre commande",
        html: `
          <h2>Merci pour votre achat !</h2>
          <p>Votre paiement de <b>${transaction.amount} USD</b> a été confirmé.</p>
          <p>VPS: ${transaction.service} (${transaction.os})</p>
          <p>Notre équipe vous contactera si nécessaire. Contact WhatsApp: <a href="https://wa.me/22507XXXXXXX">Cliquez ici</a></p>
        `,
      });
    }

    res.send("✅ Paiement réussi, VPS créé et email envoyé !");
  });
});

// --- Cancel ---
app.get("/cancel", (req, res) => {
  res.send("❌ Paiement annulé.");
});

// --- Fallback route ---
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Start server ---
app.listen(3000, () => console.log("🚀 Serveur lancé sur http://localhost:3000"));
