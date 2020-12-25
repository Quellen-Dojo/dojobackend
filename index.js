// require('firebase/firestore'); //I dont think we'll need this atm
const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const discordOauth2 = require('discord-oauth2');
const stripe = require('stripe')(process.env.stripeSK);
const https = require('https');
require('dotenv').config();

const app = express();
const oauth = new discordOauth2();

app.use(cors());

mongoose.connect('mongodb+srv://quellen:'+process.env.mongopass+'@cluster0.jxtal.mongodb.net/dojodb?retryWrites=true&w=majority',{useNewUrlParser:true,useUnifiedTopology:true});

//Schemas
const BIPlayerSchema = new mongoose.Schema({
    discordUsername: String,
    steamID: String
});

const GiveawayEntrantSchema = new mongoose.Schema({
    discord: String
});

const VIPCustomerSchema = new mongoose.Schema({
    vipsteamID: String,
    purchasedate: Date,
    paymentIntent: String
});

//Models
const BIPlayer = mongoose.model('BIPlayer',BIPlayerSchema);
const GiveawayEntrant = mongoose.model('GiveawayEntrant',GiveawayEntrantSchema);
const VIPCustomer = mongoose.model('VIPCustomer',VIPCustomerSchema);

async function sendToDiscord(message) {
    const sendWebhook = https.request('https://discord.com/api/webhooks/784141542062293032/5mMbpG03t1sGMRfy2i-drGjFpkXUzJ6pNW_HpAv1g_e97Xt-RoLZjUxGAW46D6QDFx_A',{
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })

    sendWebhook.write(JSON.stringify({content:message,avatar_url:'https://sbp-plugin-images.s3.eu-west-1.amazonaws.com/technologies1905_5eb57bd25635d_icon.jpg'}));
    sendWebhook.end();
}

app.get('/goodvip', async (req,res) => {
    const {id} = req.query;
    await sendToDiscord('VIP 76561198062410649');
    res.status(200).send();
});

app.use('/buyvip',bodyParser.json());
app.post('/buyvip',async (req,res) => {
    let resp = {exists:false,sessionid:''};
    let steamid = req.body['steamid'];
    
    if (!steamid) {res.status(500).send(); return;}

    await VIPCustomer.findOne({vipsteamID:steamid},(error,data) => {
        if (data != null) {
            resp.exists = true;
            res.json(resp).send();
            return;
        }
    });

    if (!resp.exists) {
        //Continue if doesn't already exist
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            cancel_url: 'https://epic-elion-b92a4f.netlify.app/store.html',
            success_url: 'https://epic-elion-b92a4f.netlify.app/sitemessage.html?size=3&color=ffffff&msg=Thank%20you%20for%20your%20purchase!',
            line_items: [
                {price:'price_1I1zooDDUm17J8yEy8B4icJJ',quantity:1}
            ],
            payment_intent_data: {
                metadata: {steamID:steamid,type:'vip'}
            }
        });

        resp.sessionid = session.id;
        res.json(resp);
    }
});

app.use('/buycoins',bodyParser.json());
app.post('/buycoins',async (req,res) => {
    let {steamid,quantity,priceString} = req.body;
    quantity = parseInt(quantity);
    if (!steamid || !quantity) {res.status(500).send(); return;}

    //Just in case some nucance posts me a non-int quantity

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        cancel_url: 'https://epic-elion-b92a4f.netlify.app/store.html',
        success_url: 'https://epic-elion-b92a4f.netlify.app/sitemessage.html?size=3&color=ffffff&msg=Thank%20you%20for%20your%20purchase!',
        line_items: [
            {price:priceString,quantity:quantity}
        ],
        payment_intent_data: {
            metadata: {steamID:steamid,type:'coins',quant:quantity}
        }
    });

    res.json({sessionid:session.id});
});

app.use('/payments',bodyParser.json());
app.post('/payments',(req,res) => {
    let intent = ''
    try {
        intent = req.body.data.object;
        if (req.body.type == 'payment_intent.succeeded') {
            const steamid = intent.metadata.steamID;
            switch(intent.metadata.type) {
                case 'vip':
                    VIPCustomer.create({vipsteamID:steamid,purchasedate:Date.now(),paymentIntent:intent.id}).catch(err => {
                        //BIG ERROR WITH CREATING ENTRY. Notify me somehow?
                        console.log(`Error with creating VIPCustomer with ID:${steamid}`);
                    }).then((doc) => {
                        sendToDiscord(`VIP ${steamid}`);
                    });
                    break;
                case 'coins':
                    //MAKE Stuff to give coins on the dojo! NOW!!
                    sendToDiscord(`COINS ${steamid} ${intent.metadata.quant}`);
            }
        }
    } catch {
        console.log(`Bad request sent to payments?! From ${req.ip}`);
    }
    res.status(200).end();
});

app.get('/sign',(req,res) => {
    const code = req.query['code'];
    console.log(`Sending code ${code} to discord...`);
    //First discord request
    const data = {
        clientId: '753807367484735568',
        clientSecret: process.env.clientSecret,
        grantType: 'authorization_code',
        code: code,
        redirectUri: process.env.redirectUri || 'http://127.0.0.1:5500/signupnext.html',
        scope: 'connections identify'
    };

    let userName = '';
    let id = '';
    let jsonRes = {
        got_code: false,
        has_discord: false,
        has_steam: false,
        already_exists: false
    }

    oauth.tokenRequest(data).then(res1 => {
        jsonRes.got_code = true;
        oauth.getUser(res1.access_token).then(res2 => {
            userName = res2.username+'#'+res2.discriminator;
            jsonRes.has_discord = true;
            oauth.getUserConnections(res1.access_token).then(res3 => {
                for (const conn of res3) {
                    if (conn.type == 'steam') {
                        id = conn.id;
                        jsonRes.has_steam = true;
                        break;
                    }
                }

                //No Steam connection
                if (id === '') {
                    res.json(jsonRes);
                    return;
                }

                //Check for existing player and add:
                //d will have _doc which contains _id and the fields discordUsername and steamID
                BIPlayer.findOne({steamID:id},(err,d) => {
                    if (d !== null) {
                        jsonRes.already_exists = true;
                        res.json(jsonRes);
                    } else {
                        BIPlayer.create({discordUsername:userName,steamID:id}).then(() => {
                            res.json(jsonRes);
                        }).catch(e => {
                            console.log('Error on creating BIPlayer?');
                            res.status(500).send();
                        });
                    }
                    
                });
                
            }).catch(() => res.status(500).send())
        }).catch(() => res.status(500).send());
    }).catch(() => {
        console.log('Error from Discord...');
        res.status(500).send();
    });
});

let port = process.env.PORT || 3000;

app.listen(port,() => {
    console.log('App listening');
});