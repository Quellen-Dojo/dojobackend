// require('firebase/firestore'); //I dont think we'll need this atm
require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const discordOauth2 = require('discord-oauth2');
const stripe = require('stripe')(process.env.stripeSK);
const https = require('https');
const nodemailer = require('nodemailer');

var transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: "thedojodiscord@gmail.com",
        pass: process.env.emailPass
    },
    tls: {
        rejectUnauthorized: false
    }
});

const app = express();
const oauth = new discordOauth2({requestTimeout:4000});

app.use(cors());
app.use(bodyParser.json());

mongoose.connect('mongodb+srv://quellen:'+process.env.mongopass+'@cluster0.jxtal.mongodb.net/dojodb?retryWrites=true&w=majority',{useNewUrlParser:true,useUnifiedTopology:true});

//Schemas
const BIPlayerSchema = new mongoose.Schema({
    discordUsername: String,
    steamID: String
});

const GiveawayEntrantSchema = new mongoose.Schema({
    discordUsername: String
});

const VIPCustomerSchema = new mongoose.Schema({
    vipsteamID: String,
    purchasedate: Date,
    paymentIntent: String
});

const GameStatesSchema = new mongoose.Schema({
    giveawaysActive: Boolean,
    baseInvadersActive: Boolean
});

//Models
const BIPlayer = mongoose.model('BIPlayer',BIPlayerSchema);
const GiveawayEntrant = mongoose.model('GiveawayEntrant',GiveawayEntrantSchema);
const VIPCustomer = mongoose.model('VIPCustomer',VIPCustomerSchema);
const GameState = mongoose.model('GameState',GameStatesSchema);

const theStateId = '5fec3262c936d15a08ae0269';


async function getGameStates() {
    let cState = await GameState.findById(theStateId).exec();
    return cState;
}

async function sendToDiscord(message) {
    const sendWebhook = https.request(process.env.discordWebhook,{
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })

    sendWebhook.write(JSON.stringify({content:message,avatar_url:'https://sbp-plugin-images.s3.eu-west-1.amazonaws.com/technologies1905_5eb57bd25635d_icon.jpg'}));
    sendWebhook.end();
}

app.get('/ping',async (req,res) => {
    res.send('Pong!');
});

app.get('/biplayers',async (req,res) => {
    const key = req.query['key'];
    if (key != process.env.stateEditKey) {res.status(500).send(); return;}
    const biplayers = {};
    const allBIDocs = await BIPlayer.find((err,data) => {
        if(!err){
            data.map(v => biplayers[v.discordUsername] = v.steamID);
        } else {
            console.log('Error retrieving all BIPlayers');
        }
    });
    res.json(biplayers).send();
});

app.get('/gaentries',async (req,res) => {
    const key = req.query['key'];
    if (key != process.env.stateEditKey) {res.status(500).send(); return;}
    const gaentrants = [];
    const allBIDocs = await GiveawayEntrant.find((err,data) => {
        if(!err){
            data.map(v => gaentrants.push(v.discordUsername));
        } else {
            console.log('Error retrieving all GiveawayEntrants');
        }
    });
    res.json(gaentrants).send();
});

app.post('/clearBI',async (req,res) => {
    const key = req.body['key'];
    if (key != process.env.stateEditKey) { res.status(500).send(); return;}
    await BIPlayer.deleteMany({},(err) => {
        if (err) {
            console.log(err);
            res.status(500).send();
        } else {
            res.status(200).send();
        }
    });
});

app.post('/clearGA',async (req,res) => {
    const key = req.body['key'];
    if (key != process.env.stateEditKey) { res.status(500).send(); return;}
    await GiveawayEntrant.deleteMany({},(err) => {
        if (err) {
            console.log(err);
            res.status(500).send();
        } else {
            res.status(200).send();
        }
    });
});

app.get('/states',async (req,res) => {
    let state = await getGameStates();
    res.json({BI:state.baseInvadersActive,GA:state.giveawaysActive});
});

app.post('/setStates',async (req,res) => {
    const {GA, BI, key} = req.body;
    if ((GA == undefined && BI == undefined) || key == undefined) {
        res.status(500).send();
        return;
    }
    if(key == process.env.stateEditKey) {
        if ('GA' in req.body) {
            GameState.findByIdAndUpdate(theStateId,{giveawaysActive:GA},{useFindAndModify:false},(err,data) => {
                if (!err) {
                    res.status(200);
                } else {
                    res.status(500);
                }
            });
            if (res.statusCode == 500) {
                res.send();
                return;
            }
        }
        if ('BI' in req.body) {
            GameState.findByIdAndUpdate(theStateId,{baseInvadersActive:BI},{useFindAndModify:false},(err,data) => {
                if (!err) {
                    res.status(200);
                } else {
                    res.status(500);
                }
            });
        }
        res.send();
        return;
    } else {
        res.status(500).send();
        return;
    }
});

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
            cancel_url: process.env.stripeCancel,
            success_url: process.env.stripeSuccess,
            line_items: [
                {price:process.env.stripeVIP,quantity:1}
            ],
            payment_intent_data: {
                metadata: {steamID:steamid,type:'vip'}
            }
        });

        resp.sessionid = session.id;
        res.json(resp);
    }
});

app.post('/buycoins',async (req,res) => {
    let {steamid,quantity} = req.body;
    quantity = parseInt(quantity);
    if (!steamid || !quantity) {res.status(500).send(); return;}

    //Just in case some nucance posts me a non-int quantity

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        cancel_url: process.env.stripeCancel,
        success_url: process.env.stripeSuccess,
        line_items: [
            {price:process.env.stripe1000,quantity:quantity}
        ],
        payment_intent_data: {
            metadata: {steamID:steamid,type:'coins',quant:quantity}
        }
    });

    res.json({sessionid:session.id});
});

app.post('/payments',(req,res) => {
    let intent = ''
    try {
        intent = req.body.data.object;
        if (req.body.type == 'payment_intent.succeeded') {
            const steamid = intent.metadata.steamID;
            const receipt = intent.charges.data[0].receipt_url;
            const email = intent.charges.data[0].billing_details.email;
            const cust_name = intent.charges.data[0].billing_details.name;
            const receipt_message = {
                from: 'thedojodiscord@gmail.com',
                to: email,
                subject: 'The Dojo (RECEIPT): Thank you for your purchase!',
            }
            if (steamid) {
                receipt_message.text = `Thank you for purchasing from The Dojo\'s online store, ${cust_name}!\nThe steam account receiving your item(s) can be found here: https://steamid.io/lookup/${steamid}\n\nYour receipt can be found here:\n${receipt}`;
            } else {
                receipt_message.text = `Thank you for purchasing from The Dojo\'s online store, ${cust_name}!\n\nYour receipt can be found here:\n${receipt}`;
            }
            transport.sendMail(receipt_message, (err, info) => {
                if (err) {
                    sendToDiscord('Error sending receipt email! ' + err);
                    // console.log('Error with email send: '+ err);
                } else {
                    console.log(info);
                }
            });
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
                    // console.log('Coins succeeded');
                    sendToDiscord(`COINS ${steamid} ${intent.metadata.quant}`);
            }
        }
    } catch(err) {
        console.log(`Bad request sent to payments?! From ${req.ip}`);
        console.log(err);
    }
    res.status(200).end();
});

app.get('/giveaway', async (req, res) => {
    const code = req.query['code'];
    const state = await getGameStates();
    if (code && state['giveawaysActive']) {
        const data = {
            clientId: '753807367484735568',
            clientSecret: process.env.clientSecret,
            grantType: 'authorization_code',
            code: code,
            redirectUri: process.env.giveawayRedirectUri || 'http://127.0.0.1:5500/giveawaynext.html',
            scope: 'identify'
        };

        
        oauth.tokenRequest(data).catch(e1 => console.log(`Error on oauth.tokenRequrest(): ${e1}`)).then(tres => {
            oauth.getUser(tres.access_token).catch(err => {
                console.log(`Error from oauth.getUser(): ${err}`);
            }).then(user => {
                let username = user.username + '#' + user.discriminator;
                GiveawayEntrant.findOne({ discordUsername: username }, (err, dat) => {
                    if (dat == null) {
                        GiveawayEntrant.create({ discordUsername: username }).then(() => {
                            res.json({ exists: false }).send()
                        });
                    } else {
                        res.json({ exists: true }).send()
                    }
                });
            });
        });
    } else {
        res.status(500).send();
    }
});

app.get('/sign',async (req,res) => {
    const code = req.query['code'];
    const state = await getGameStates();
    if (code && state['baseInvadersActive']) {
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
                                res.json(jsonRes).send();
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
    } else {
        res.status(500).send();
    }
});

let port = process.env.PORT || 3000;

app.listen(port,() => {
    console.log(`App listening on ${port}`);
});