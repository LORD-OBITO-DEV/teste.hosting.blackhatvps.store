import express from "express";
import mongoose from "mongoose";
import config from "./config.js";
import paypal from "paypal-rest-sdk";
import nodemailer from "nodemailer";
import Transaction from "./models/Transaction.js";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

mongoose.connect(config.MONGO_URI).then(()=>console.log("✅ MongoDB connecté"));

paypal.configure({
  mode: config.PAYPAL_MODE,
  client_id: config.PAYPAL_CLIENT_ID,
  client_secret: config.PAYPAL_CLIENT_SECRET,
});

// Création paiement PayPal
app.post("/pay", async (req,res)=>{
  try{
    const { name, wa, email, service, os, currency } = req.body;
    const plan = getPlanPrice(service); // fonction pour récupérer prix final
    const transaction = await Transaction.create({ name, wa, email, service, os, currency });

    const create_payment_json = {
      intent:"sale",
      payer:{ payment_method:"paypal" },
      redirect_urls:{
        return_url:`${config.SITE_URL}/success`,
        cancel_url:`${config.SITE_URL}/cancel`
      },
      transactions:[{
        item_list:{ items:[{ name: service, sku:"001", price:plan, currency:"USD", quantity:1 }]},
        amount:{ currency:"USD", total:plan },
        description:`VPS ${service} via BlackHatVPS`
      }]
    };

    paypal.payment.create(create_payment_json,(err,payment)=>{
      if(err) return res.json({ error:err.message });
      transaction.paymentId = payment.id;
      transaction.save();
      const approvalUrl = payment.links.find(l=>l.rel==="approval_url").href;
      res.json({ approvalUrl });
    });
  } catch(err){ res.json({ error:err.message }); }
});

// Succès paiement
app.get("/success", async (req,res)=>{
  const { paymentId, PayerID } = req.query;
  paypal.payment.execute(paymentId,{ payer_id:PayerID }, async (err,payment)=>{
    if(err) return res.send("Erreur PayPal");

    const transaction = await Transaction.findOneAndUpdate({ paymentId },{ status:"completed", payerId:PayerID },{ new:true });

    // === Création VPS sur Hostinger ===
    if(transaction){
      await createVPSHostinger(transaction.service, transaction.os, transaction.email);
    }

    // === Envoi email ===
    const transporter = nodemailer.createTransport({
      service:"gmail",
      auth:{ user:config.MAIL_USER, pass:config.MAIL_PASS }
    });
    await transporter.sendMail({
      from:`BlackHatVPS <${config.MAIL_USER}>`,
      to:transaction.email,
      subject:"✅ Votre VPS est prêt",
      html:`<h2>Merci pour votre achat !</h2>
        <p>Votre VPS ${transaction.service} (${transaction.os}) est prêt.</p>
        <p>Nos équipes vous contactent si besoin. 📧 Support: ${config.MAIL_USER}</p>`
    });

    res.send("<script>alert('Nous vous avons envoyé un mail avec les informations de votre VPS, merci et bonne journée !'); window.location='/';</script>");
  });
});

app.get("/cancel",(req,res)=>res.send("❌ Paiement annulé."));

function getPlanPrice(planId){
  const plans = { "vps1":4.39,"vps2":8.79,"vps3":17.59,"vps4":35.19 }; // prix +10% +5%
  return plans[planId] || 4.39;
}

// ==== Fonction de création VPS Hostinger ====
async function createVPSHostinger(plan, os, email){
  // Ici tu appelles l'API Hostinger avec ton token
  // Exemple pseudo-code :
  const apiUrl = `https://api.hostinger.com/v1/vps/create`;
  await fetch(apiUrl,{
    method:"POST",
    headers:{
      "Authorization":`Bearer ${config.HOSTINGER_TOKEN}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({ plan, os, email })
  });
}

app.listen(3000,()=>console.log("🚀 Serveur sur http://localhost:3000"));
