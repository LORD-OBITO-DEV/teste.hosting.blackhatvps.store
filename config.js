import dotenv from "dotenv";
dotenv.config();

export default {
  SITE_URL: process.env.SITE_URL,
  MONGO_URI: process.env.MONGO_URI,

  PAYPAL_MODE: process.env.PAYPAL_MODE,
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,

  MAIL_USER: process.env.MAIL_USER,
  MAIL_PASS: process.env.MAIL_PASS,

  OVH_APP_KEY: process.env.OVH_APP_KEY,
  OVH_APP_SECRET: process.env.OVH_APP_SECRET,
  OVH_CONSUMER_KEY: process.env.OVH_CONSUMER_KEY,
};
