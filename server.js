import express from "express";
import mongoose from "mongoose";
import config from "./config.js";
import paypal from "paypal-rest-sdk";
import nodemailer from "nodemailer";
import Transaction from "./models/Transaction.js";
import path from "path";
import { fileURLToPath } from "url";
import OVH from "ovh"; // npm install ovh

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB
mongoose.connect(config.MONGO_URI)
  .then(()=>console.log("✅ Connecté à MongoDB"))
  .catch(err=>console.error("❌ Erreur MongoDB:", err));

// PayPal
paypal.configure({
  mode: config.PAYPAL_MODE,
  client_id: config.PAYPAL_CLIENT_ID,
  client_secret: config.PAYPAL_CLIENT_SECRET,
});

// OVH Client
const ovhClient = new OVH({
  appKey: config.OVH_APP_KEY,
  appSecret: config.OVH_APP_SECRET,
  consumerKey: config.OVH_CONSUMER_KEY,
  endpoint: "ovh-eu"
});

// Statics
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// Calcul prix final
function calcPrice(ovhPrice) {
  return ovhPrice * 1.15 * 1.05; // +15% bénéfice +5% frais
}

// API : liste des VPS OVH
app.get("/api/vps-list", async (req,res)=>{
  try {
    const vpsListRaw = await ovhClient.requestPromised("GET", "/vps"); // récupère VPS existants
    // Ici, on mappe en mock pour l'exemple
    const vpsList = vpsListRaw.map(vps=>{
      return {
        id: vps.serviceName,
        name: vps.planCode,
        price: calcPrice(10) // mettre le vrai prix OVH
      };
    });
    res.json(vpsList);
  } catch(e) {
    console.error(e);
    res.status(500).send("Erreur récupération VPS");
  }
});

// Endpoint paiement
app.post("/pay", async (req,res)=>{
  try {
    const { email, amount, vpsId, os } = req.body;
    const transaction = await Transaction.create({ email, amount, vpsId, os });

    const create_payment_json = {
      intent: "sale",
      payer: { payment_method:"paypal" },
      redirect_urls: {
        return_url: `${config.SITE_URL}/success`,
        cancel_url: `${config.SITE_URL}/cancel`,
      },
      transactions: [{
        item_list:{ items:[{ name:"VPS Service", sku:vpsId, price:amount, currency:"USD", quantity:1 }]},
        amount:{ currency:"USD", total:amount },
        description:`VPS ${vpsId} (${os}) via BlackHatVPS`
      }]
    };

    paypal.payment.create(create_payment_json, (err,payment)=>{
      if(err) return res.status(500).json({ error: err });
      transaction.paymentId = payment.id;
      transaction.save();
      const approvalUrl = payment.links.find(l=>l.rel==="approval_url").href;
      res.json({ approvalUrl });
    });

  } catch(e) {
    res.status(500).json({ error:e.message });
  }
});

// Endpoint succès
app.get("/success", async (req,res)=>{
  const { paymentId, PayerID } = req.query;

  paypal.payment.execute(paymentId, { payer_id:PayerID }, async (err,payment)=>{
    if(err) return res.status(500).send(err);

    const transaction = await Transaction.findOneAndUpdate(
      { paymentId },
      { status:"completed", payerId:PayerID },
      { new:true }
    );

    // ✅ Création VPS OVH automatique
    try {
      const createVPS = await ovhClient.requestPromised("POST", "/vps/{serviceName}/create", {
        serviceName: transaction.vpsId,
        model: transaction.vpsId,
        os: transaction.os,
      });
      console.log("VPS créé:", createVPS);
    } catch(e) {
      console.error("Erreur création VPS:", e);
    }

    // ✅ Envoi mail
    if(transaction?.email){
      const transporter = nodemailer.createTransport({
        service:"gmail",
        auth:{ user:config.MAIL_USER, pass:config.MAIL_PASS }
      });
      await transporter.sendMail({
        from:`"BlackHatVPS" <${config.MAIL_USER}>`,
        to: transaction.email,
        subject:"✅ Confirmation commande VPS",
        html:`
          <h2>Merci pour votre achat !</h2>
          <p>VPS: ${transaction.vpsId} (${transaction.os})</p>
          <p>Montant payé: ${transaction.amount} USD</p>
          <p>Nous vous contacterons via WhatsApp pour vos identifiants.</p>
        `
      });
    }

    res.send("✅ Paiement validé, VPS créé et mail envoyé !");
  });
});

app.get("/cancel", (req,res)=>res.send("❌ Paiement annulé."));

// Route fallback
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

// Start
app.listen(3000,()=>console.log("🚀 Serveur lancé sur http://localhost:3000"));
