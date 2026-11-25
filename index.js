// Silencia logs gigantes de criptografia (Closing session) no terminal
const origInfo = console.info;
console.info = function (...args) {
    if (typeof args[0] === 'string' && args[0].includes('Closing session')) return;
    origInfo.apply(console, args);
};

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadMediaMessage,
    generateWAMessageFromContent,
    prepareWAMessageMedia,
    Browsers
} = require('whaileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const HINATA_URL_PADRAO = 'https://cdn.myanimelist.net/images/characters/6/278736.jpg';

const dbPath = path.join(__dirname, 'database.json');
const packDir = path.join(__dirname, 'stickers_pack');
const menuImgPath = path.join(__dirname, 'menu.jpg');

if (!fs.existsSync(packDir)) {
    fs.mkdirSync(packDir);
}

// Memorias temporarias em tempo de execucao
const jogosVelha = {};
const downloadsPendentes = {};
const solicitacoesPet = {};
let eventoPetAtivo = null;

// Limite maximo de aposta por rodada para evitar inflacao de trilhoes
const LIMITE_APOSTA = 10000000; // 10 Milhoes

// ==========================================
// TABELAS DA LOJA PRINCIPAL E DO SISTEMA DE PETS
// ==========================================
const ITENS_LOJA = {
    1: { id: 1, nome: 'Picareta de Ferro', preco: 500, tipo: 'pickaxe', nivel: 2, desc: 'Ganha 2x mais Gold ao minerar' },
    2: { id: 2, nome: 'Picareta de Diamante', preco: 2000, tipo: 'pickaxe', nivel: 4, desc: 'Ganha 4x mais Gold ao minerar' },
    3: { id: 3, nome: 'Escudo Anti-Roubo', preco: 350, tipo: 'shield', desc: 'Bloqueia o proximo assalto normal contra voce' },
    4: { id: 4, nome: 'Titulo VIP [Magnata]', preco: 5000, tipo: 'title', titulo: '💎 Magnata', desc: 'Exibe a tag VIP no Ranking de Gold' }
};

const CATALOGO_PETS = {
    1: { id: 1, especie: 'Cachorro', emoji: '🐶', raridade: 'Comum', preco: 600, poder: 1.0 },
    2: { id: 2, especie: 'Gato', emoji: '🐱', raridade: 'Comum', preco: 600, poder: 1.0 },
    3: { id: 3, especie: 'Coelho', emoji: '🐰', raridade: 'Comum', preco: 800, poder: 1.1 },
    4: { id: 4, especie: 'Sapo', emoji: '🐸', raridade: 'Comum', preco: 800, poder: 1.1 },
    5: { id: 5, especie: 'Tartaruga', emoji: '🐢', raridade: 'Raro', preco: 2500, poder: 1.3 },
    6: { id: 6, especie: 'Raposa', emoji: '🦊', raridade: 'Raro', preco: 3500, poder: 1.4 },
    7: { id: 7, especie: 'Panda', emoji: '🐼', raridade: 'Épico', preco: 8000, poder: 1.7 },
    8: { id: 8, especie: 'Lobo', emoji: '🐺', raridade: 'Épico', preco: 12000, poder: 1.85 },
    9: { id: 9, especie: 'Dragão', emoji: '🐉', raridade: 'Lendário', preco: 35000, poder: 2.5 },
    10: { id: 10, especie: 'Unicórnio', emoji: '🦄', raridade: 'Lendário', preco: 45000, poder: 2.7 }
};

const LOJA_PETS = {
    1: { id: 1, key: 'racao', nome: 'Ração Premium', emoji: '🍖', preco: 80, desc: 'Recupera +40 de Fome e +10 de Saúde' },
    2: { id: 2, key: 'leite', nome: 'Leite Fresco', emoji: '🥛', preco: 90, desc: 'Recupera +35 de Energia e +15 de Fome' },
    3: { id: 3, key: 'brinquedo', nome: 'Brinquedo', emoji: '🧸', preco: 150, desc: 'Aumenta +45 de Felicidade' },
    4: { id: 4, key: 'shampoo', nome: 'Shampoo Pet', emoji: '🧴', preco: 120, desc: 'Recupera 100% da Higiene e +15 de Saúde' },
    5: { id: 5, key: 'caminha', nome: 'Caminha Macia', emoji: '🛏️', preco: 1200, desc: 'Item permanente: reduz tempo de descanso e recupera 100% Energia' },
    6: { id: 6, key: 'acessorio', nome: 'Acessório Real', emoji: '🎀', preco: 2000, desc: 'Personaliza o animal e dá bônus em duelos' },
    7: { id: 7, key: 'osso', nome: 'Osso Mágico', emoji: '🦴', preco: 900, desc: 'Concede +150 XP instantâneo ao pet' }
};

function carregarDB() {
    if (!fs.existsSync(dbPath)) {
        const ini = { prefix: ',', owners: [], users: {}, groups: {}, brain: { pares: {}, soltas: [] } };
        fs.writeFileSync(dbPath, JSON.stringify(ini, null, 2));
        return ini;
    }
    try {
        const d = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
        if (!d.owners) d.owners = [];
        d.owners = d.owners.filter(n => n && n !== '556899999999' && n !== '556888888888');
        if (!d.users) d.users = {};
        if (!d.groups) d.groups = {};
        if (!d.brain) d.brain = { pares: {}, soltas: [] };
        if (!d.brain.pares) d.brain.pares = {};
        if (!d.brain.soltas) d.brain.soltas = [];
        if (!d.prefix) d.prefix = ',';
        return d;
    } catch (e) {
        return { prefix: ',', owners: [], users: {}, groups: {}, brain: { pares: {}, soltas: [] } };
    }
}

function salvarDB(db) {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function limparNum(jid) {
    if (!jid) return '';
    return jid.split('@')[0].split(':')[0].replace(/\D/g, '');
}

function mesmoUsuario(jidA, jidB) {
    if (!jidA || !jidB) return false;
    const baseA = jidA.split('@')[0].split(':')[0];
    const baseB = jidB.split('@')[0].split(':')[0];
    if (baseA === baseB) return true;

    const numA = baseA.replace(/\D/g, '');
    const numB = baseB.replace(/\D/g, '');
    if (!numA || !numB) return false;
    if (numA === numB) return true;

    if (numA.length >= 10 && numB.length >= 10) {
        const dddA = numA.slice(0, 4);
        const dddB = numB.slice(0, 4);
        const finalA = numA.slice(-8);
        const finalB = numB.slice(-8);
        if (dddA === dddB && finalA === finalB) return true;
    }
    return false;
}

function obterUser(db, jid, nome) {
    if (!db.users[jid]) {
        db.users[jid] = {
            gold: 100,
            lastMine: 0,
            lastRob: 0,
            pickaxe: 1,
            shields: 0,
            title: '',
            stolenBy: null,
            name: nome || limparNum(jid),
            pets: [],
            activePet: 0,
            petInv: { racao: 1, leite: 1, brinquedo: 0, shampoo: 0, caminha: 0, acessorio: 0, osso: 0 }
        };
    } else {
        const u = db.users[jid];
        if (nome) u.name = nome;
        if (!u.pickaxe) u.pickaxe = 1;
        if (u.shields === undefined) u.shields = 0;
        if (!u.title) u.title = '';
        if (u.stolenBy === undefined) u.stolenBy = null;
        if (!u.pets) u.pets = [];
        if (u.activePet === undefined) u.activePet = 0;
        if (!u.petInv) {
            u.petInv = { racao: 1, leite: 1, brinquedo: 0, shampoo: 0, caminha: 0, acessorio: 0, osso: 0 };
        }
    }
    return db.users[jid];
}

function obterGrupo(db, groupJid) {
    if (!db.brain) db.brain = { pares: {}, soltas: [] };
    if (!db.groups[groupJid]) {
        db.groups[groupJid] = {
            antilink: false,
            autoResp: true,
            welcome: true,
            welcomeMsg: '',
            customResps: {},
            iaAtiva: true,
            iaChance: 25
        };
    }
    const g = db.groups[groupJid];
    if (g.autoResp === undefined) g.autoResp = true;
    if (g.welcome === undefined) g.welcome = true;
    if (g.welcomeMsg === undefined) g.welcomeMsg = '';
    if (!g.customResps) g.customResps = {};
    if (g.iaAtiva === undefined) g.iaAtiva = true;
    if (g.iaChance === undefined) g.iaChance = 25;
    return g;
}

// ==========================================
// FUNCOES AUXILIARES DOS PETS
// ==========================================
function criarNovoPet(modelo, nomeCustom) {
    return {
        uid: Date.now() + Math.floor(Math.random() * 1000),
        idEspecie: modelo.id,
        nome: nomeCustom || modelo.especie,
        especie: modelo.especie,
        emoji: modelo.emoji,
        raridade: modelo.raridade,
        poder: modelo.poder,
        nivel: 1,
        xp: 0,
        fome: 100,
        felicidade: 100,
        energia: 100,
        higiene: 100,
        saude: 100,
        acessorio: '',
        vitorias: 0,
        lastUpdate: Date.now(),
        cooldowns: {
            alimentar: 0,
            brincar: 0,
            carinho: 0,
            banho: 0,
            dormir: 0,
            treinar: 0,
            duelo: 0,
            casal: 0
        }
    };
}

function obterFaseEvolucao(nivel) {
    if (nivel <= 5) return '🐣 Filhote';
    if (nivel <= 10) return '🐾 Jovem';
    if (nivel <= 20) return '🦁 Adulto';
    if (nivel <= 30) return '⚔️ Experiente';
    return '👑 Especial';
}

function barraStatus(valor) {
    const cheios = Math.max(0, Math.min(10, Math.round(valor / 10)));
    return '█'.repeat(cheios) + '░'.repeat(10 - cheios) + ' ' + Math.round(valor) + '%';
}

function atualizarDesgastePet(pet) {
    if (!pet) return null;
    const agora = Date.now();
    const horasPassadas = (agora - (pet.lastUpdate || agora)) / (1000 * 60 * 60);

    if (horasPassadas >= 0.08) {
        pet.fome = Math.max(0, Math.round(pet.fome - (horasPassadas * 6)));
        pet.higiene = Math.max(0, Math.round(pet.higiene - (horasPassadas * 5)));
        pet.energia = Math.max(0, Math.round(pet.energia - (horasPassadas * 4)));
        pet.felicidade = Math.max(0, Math.round(pet.felicidade - (horasPassadas * 5)));

        if (pet.fome <= 15 || pet.higiene <= 15) {
            pet.saude = Math.max(10, Math.round(pet.saude - (horasPassadas * 6)));
        } else if (pet.fome >= 70 && pet.higiene >= 70) {
            pet.saude = Math.min(100, Math.round(pet.saude + (horasPassadas * 3)));
        }
        pet.lastUpdate = agora;
    }
    if (!pet.cooldowns) {
        pet.cooldowns = { alimentar: 0, brincar: 0, carinho: 0, banho: 0, dormir: 0, treinar: 0, duelo: 0, casal: 0 };
    }
    return pet;
}

function pegarPetAtivo(user) {
    if (!user.pets || user.pets.length === 0) return null;
    if (user.activePet >= user.pets.length || user.activePet < 0) user.activePet = 0;
    return atualizarDesgastePet(user.pets[user.activePet]);
}

function adicionarXpPet(pet, user, qtdXp) {
    pet.xp += qtdXp;
    let subiu = false;
    let recompensaTotal = 0;
    let msgEvolucao = '';

    while (pet.xp >= pet.nivel * 100) {
        pet.xp -= pet.nivel * 100;
        pet.nivel += 1;
        subiu = true;
        const premioGold = pet.nivel * 150;
        recompensaTotal += premioGold;
        user.gold += premioGold;
    }

    if (subiu) {
        const fase = obterFaseEvolucao(pet.nivel);
        msgEvolucao = `\n\n🎉 *LEVEL UP!* Seu pet subiu para o *Nível ${pet.nivel}* (${fase})!\n💰 Bônus de evolução: *+${recompensaTotal.toLocaleString('pt-BR')} Gold*!`;
    }
    return msgEvolucao;
}

function checarCooldown(timestampAntigo, tempoMs) {
    const agora = Date.now();
    const rest = tempoMs - (agora - (timestampAntigo || 0));
    if (rest > 0) {
        const min = Math.floor(rest / 60000);
        const seg = Math.ceil((rest % 60000) / 1000);
        return min > 0 ? `${min}m ${seg}s` : `${seg}s`;
    }
    return null;
}

function renderTabuleiro(b) {
    const emojis = { '1': '1️⃣', '2': '2️⃣', '3': '3️⃣', '4': '4️⃣', '5': '5️⃣', '6': '6️⃣', '7': '7️⃣', '8': '8️⃣', '9': '9️⃣', 'X': '❌', 'O': '⭕' };
    return `${emojis[b[0]]} ${emojis[b[1]]} ${emojis[b[2]]}\n${emojis[b[3]]} ${emojis[b[4]]} ${emojis[b[5]]}\n${emojis[b[6]]} ${emojis[b[7]]} ${emojis[b[8]]}`;
}

function checarVencedorVelha(b) {
    const linhas = [
        [0,1,2], [3,4,5], [6,7,8],
        [0,3,6], [1,4,7], [2,5,8],
        [0,4,8], [2,4,6]
    ];
    for (const [x, y, z] of linhas) {
        if (b[x] === b[y] && b[y] === b[z]) return b[x];
    }
    if (b.every(c => c === 'X' || c === 'O')) return 'EMPATE';
    return null;
}

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('\nEscaneie o QR Code:\n');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code === 440) {
                console.log('Conflito de sessao (440). Feche outra janela aberta.');
                return;
            }
            const reconectar = code !== DisconnectReason.loggedOut;
            console.log('Conexao fechada:', code, 'Reconectar:', reconectar);
            if (reconectar) setTimeout(() => iniciarBot(), 3000);
        } else if (connection === 'open') {
            const db = carregarDB();
            const botNum = limparNum(sock.user?.id);
            if (botNum && !db.owners.includes(botNum)) {
                db.owners.push(botNum);
            }
            salvarDB(db);
            console.log('🌸 Hinata Bot + IA + Whaileys Sticker c/ Som Conectada! Donos:', db.owners.join(', '), '| Prefixo:', db.prefix);
        }
    });

    // ==========================================
    // SISTEMA DE BOAS-VINDAS AUTOMATICO COM DESCRICAO DO GRUPO
    // ==========================================
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            if (anu.action !== 'add') return;
            const db = carregarDB();
            const groupCfg = obterGrupo(db, anu.id);
            if (!groupCfg.welcome) return;

            const meta = await sock.groupMetadata(anu.id);
            const nomeGrupo = meta.subject || 'Grupo';
            const descGrupo = meta.desc ? meta.desc.toString() : 'Sem descrição definida no grupo.';

            for (const pItem of anu.participants) {
                const jidNovo = typeof pItem === 'string' ? pItem : (pItem.id || pItem.phoneNumber || '');
                if (!jidNovo) continue;
                const numNovo = limparNum(jidNovo);

                let linhasBv = [
                    `🌸 *BEM-VINDO(A) AO ${nomeGrupo.toUpperCase()}!* 🌸`,
                    '',
                    `👋 Olá @${numNovo}, seja muito bem-vindo(a)!`
                ];

                if (groupCfg.welcomeMsg) {
                    linhasBv.push('');
                    linhasBv.push(`💬 ${groupCfg.welcomeMsg}`);
                }

                linhasBv.push('');
                linhasBv.push('📋 *DESCRIÇÃO / REGRAS DO GRUPO:*');
                linhasBv.push(descGrupo);
                linhasBv.push('');
                linhasBv.push(`🤖 Digite *${db.prefix}menu* para conhecer os comandos da Hinata Bot!`);

                const textoFinalBv = linhasBv.join('\n');

                if (fs.existsSync(menuImgPath)) {
                    await sock.sendMessage(anu.id, {
                        image: fs.readFileSync(menuImgPath),
                        caption: textoFinalBv,
                        mentions: [jidNovo]
                    });
                } else {
                    await sock.sendMessage(anu.id, {
                        text: textoFinalBv,
                        mentions: [jidNovo]
                    });
                }
            }
        } catch (err) {
            console.log('Erro no boas-vindas:', err.message);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;

        const from = m.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = m.key.participant || m.key.remoteJid;
        const senderNum = limparNum(sender);
        const botId = sock.user?.id || '';
        const botLid = sock.user?.lid || '';
        const botNum = limparNum(botId);
        const pushName = m.pushName || senderNum;
        const tipoMsg = Object.keys(m.message)[0];

        const texto = m.message.conversation ||
                      m.message.extendedTextMessage?.text ||
                      m.message.imageMessage?.caption ||
                      m.message.videoMessage?.caption || '';

        const db = carregarDB();
        const p = db.prefix;
        const isOwner = m.key.fromMe || mesmoUsuario(sender, botId) || (botLid && mesmoUsuario(sender, botLid)) || db.owners.some(o => mesmoUsuario(sender, o));
        const groupCfg = obterGrupo(db, from);

        const responder = (txt, mentions = []) => {
            return sock.sendMessage(from, { text: txt, mentions }, { quoted: m });
        };

        // ==========================================
        // DOWNLOAD MP3 E MP4 OTIMIZADO PARA TERMUX E WINDOWS
        // ==========================================
        async function processarDownload(url, formato) {
            const termuxBin = '/data/data/com.termux/files/usr/bin';
            const flagFfmpeg = fs.existsSync(termuxBin) ? `--ffmpeg-location "${termuxBin}" ` : '';

            if (formato === 'mp3') {
                await responder('🎵 Baixando e convertendo para *MP3 (Musica)*, aguarde...');
                const outA = path.join(__dirname, 'aud_' + Date.now() + '.mp3');
                const dlCmd = `yt-dlp ${flagFfmpeg}--extractor-args "youtube:player_client=android" -x --audio-format mp3 --max-filesize 50M -o "${outA}" "${url}"`;

                exec(dlCmd, async (err, stdout, stderr) => {
                    if (err || !fs.existsSync(outA)) {
                        console.log('Erro yt-dlp mp3:', stderr || err?.message);
                        return responder('❌ Erro ao baixar o audio. Verifique se o link e publico e valido.');
                    }
                    try {
                        await sock.sendMessage(from, {
                            audio: fs.readFileSync(outA),
                            mimetype: 'audio/mpeg'
                        }, { quoted: m });
                    } catch (e) {
                        await responder('❌ Erro ao enviar o arquivo de audio.');
                    } finally {
                        if (fs.existsSync(outA)) fs.unlinkSync(outA);
                    }
                });
            } else {
                await responder('🎬 Baixando *Video (MP4)*, aguarde...');
                const outV = path.join(__dirname, 'vid_' + Date.now() + '.mp4');
                const dlCmd = `yt-dlp ${flagFfmpeg}--extractor-args "youtube:player_client=android" -f "best[ext=mp4][height<=720]/best[ext=mp4]/best" --max-filesize 50M -o "${outV}" "${url}"`;

                exec(dlCmd, async (err, stdout, stderr) => {
                    if (err || !fs.existsSync(outV)) {
                        console.log('Erro yt-dlp mp4:', stderr || err?.message);
                        return responder('❌ Erro ao baixar o video. Verifique se o link e publico e valido.');
                    }
                    try {
                        await sock.sendMessage(from, {
                            video: fs.readFileSync(outV),
                            caption: '✅ Video baixado com sucesso!'
                        }, { quoted: m });
                    } catch (e) {
                        await responder('❌ Erro ao enviar o video.');
                    } finally {
                        if (fs.existsSync(outV)) fs.unlinkSync(outV);
                    }
                });
            }
        }

        async function verificarAdms() {
            if (!isGroup) return { isSenderAdmin: isOwner, isBotAdmin: false };
            try {
                const meta = await sock.groupMetadata(from);
                const listaAdms = meta.participants.filter(x => x.admin === 'admin' || x.admin === 'superadmin');

                const senderEhAdm = isOwner || listaAdms.some(x =>
                    mesmoUsuario(x.id, sender) ||
                    (x.lid && mesmoUsuario(x.lid, sender)) ||
                    (x.phoneNumber && mesmoUsuario(x.phoneNumber, sender))
                );

                const botEhAdm = listaAdms.some(x =>
                    mesmoUsuario(x.id, botId) ||
                    (botLid && mesmoUsuario(x.id, botLid)) ||
                    (x.lid && botLid && mesmoUsuario(x.lid, botLid)) ||
                    (x.phoneNumber && mesmoUsuario(x.phoneNumber, botId))
                );

                return {
                    isSenderAdmin: senderEhAdm,
                    isBotAdmin: botEhAdm
                };
            } catch (e) {
                return { isSenderAdmin: isOwner, isBotAdmin: true };
            }
        }

        // ==========================================
        // SISTEMA ANTI-LINK BLINDADO (INCLUI CASSINOS, LEGENDAS E ENCURTADORES)
        // ==========================================
        const textoCompletoAntiLink = [
            texto,
            m.message.imageMessage?.caption,
            m.message.videoMessage?.caption,
            m.message.documentMessage?.caption,
            m.message.extendedTextMessage?.matchedText,
            m.message.extendedTextMessage?.canonicalUrl,
            m.message.extendedTextMessage?.title,
            m.message.extendedTextMessage?.description
        ].filter(Boolean).join(' ');

        if (isGroup && textoCompletoAntiLink && groupCfg.antilink) {
            const textoNormalizado = textoCompletoAntiLink
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase();

            const regexLinkGeral = /(https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/|t\.me\/|bit\.ly\/|tinyurl\.com\/|linktr\.ee\/|[a-z0-9-]+\s*\.\s*(com|net|org|xyz|bet|casino|cassino|vip|top|br|io|app|online|site|win|club|fun|click|link|pro|live|game|games|play|slot|slots)\b)/i;
            const regexSpamCassino = /(plataforma\s+(nova|pagando)|link\s+na\s+bio|cadastre-?se\s+e\s+ganhe|bonus\s+de\s+cadastro|fortune\s+tiger|jogo\s+do\s+tigrinho|saque\s+rapido\s+via\s+pix)/i;

            const txtLimpo = textoNormalizado.trim();
            const ehComandoBaixar = txtLimpo.startsWith(p + 'baixar') || txtLimpo.startsWith(p + 'dl') || txtLimpo.startsWith(p + 'mp3') || txtLimpo.startsWith(p + 'mp4') || txtLimpo.startsWith(p + 'musica');

            if ((regexLinkGeral.test(textoNormalizado) || regexSpamCassino.test(textoNormalizado)) && !ehComandoBaixar) {
                const { isSenderAdmin } = await verificarAdms();
                if (!isSenderAdmin) {
                    try {
                        await sock.sendMessage(from, { delete: m.key });
                    } catch (e) {}

                    try {
                        await sock.groupParticipantsUpdate(from, [sender], 'remove');
                        await sock.sendMessage(from, {
                            text: '🚫 *ANTI-LINK / ANTI-CASSINO ATIVADO!*\n@' + senderNum + ' enviou link ou divulgação proibida e foi banido imediatamente.',
                            mentions: [sender]
                        });
                    } catch (errBan) {
                        await sock.sendMessage(from, {
                            text: '⚠️ @' + senderNum + ' enviou link proibido! (Coloque a Hinata Bot como Administradora do grupo para banir automaticamente).',
                            mentions: [sender]
                        }, { quoted: m });
                    }
                    return;
                }
            }
        }

        // ==========================================
        // CAPTURA DA ESCOLHA [1 = VIDEO] OU [2 = MUSICA], RESPOSTAS E IA SIMSIMI
        // ==========================================
        const chaveDownload = from + '_' + sender;
        if (!texto.trim().startsWith(p)) {
            const txtLow = texto.trim().toLowerCase();

            if (downloadsPendentes[chaveDownload]) {
                const pend = downloadsPendentes[chaveDownload];
                if (Date.now() - pend.time < 120000) {
                    if (txtLow === '1' || txtLow === 'video' || txtLow === 'mp4') {
                        delete downloadsPendentes[chaveDownload];
                        return processarDownload(pend.url, 'mp4');
                    } else if (txtLow === '2' || txtLow === 'musica' || txtLow === 'audio' || txtLow === 'mp3') {
                        delete downloadsPendentes[chaveDownload];
                        return processarDownload(pend.url, 'mp3');
                    }
                } else {
                    delete downloadsPendentes[chaveDownload];
                }
            }

            if (!m.key.fromMe && texto && groupCfg.autoResp) {
                if (groupCfg.customResps && Object.keys(groupCfg.customResps).length > 0) {
                    for (const [gatilho, respostaSalva] of Object.entries(groupCfg.customResps)) {
                        if (txtLow === gatilho || txtLow.includes(gatilho)) {
                            return await sock.sendMessage(from, { text: respostaSalva }, { quoted: m });
                        }
                    }
                }

                if (txtLow === 'oi bot' || txtLow === 'ola bot' || txtLow === 'bot') {
                    const frases = [
                        '🌸 Oi! Eu sou a Hinata Bot! Digite *' + p + 'menu* para ver meus comandos.',
                        '☢️ Alguem ficando rico demais no grupo? Jogue uma *' + p + 'bomba @user* por 1 Milhao de Gold!',
                        '🎭 Quer zoar a galera do grupo? Digite *' + p + 'brincadeiras*!'
                    ];
                    const resp = frases[Math.floor(Math.random() * frases.length)];
                    return await sock.sendMessage(from, { text: resp }, { quoted: m });
                } else if (txtLow === 'bom dia' || txtLow === 'bom dia bot') {
                    return await sock.sendMessage(from, { text: '☀️ Bom dia! Nao esqueca de usar *' + p + 'alimentar* para cuidar do seu Pet!' }, { quoted: m });
                } else if (txtLow === 'boa tarde' || txtLow === 'boa tarde bot') {
                    return await sock.sendMessage(from, { text: '🌤️ Boa tarde! Que tal colocar seu pet para duelar com *' + p + 'petduelo*?' }, { quoted: m });
                } else if (txtLow === 'boa noite' || txtLow === 'boa noite bot') {
                    return await sock.sendMessage(from, { text: '🌙 Boa noite! Coloque seu bichinho para descansar com *' + p + 'dormir*!' }, { quoted: m });
                }

                // =========================================================
                // 🧠 3. SISTEMA DE APRENDIZADO AUTOMATICO (ESTILO SIMSIMI)
                // =========================================================
                if (isGroup && groupCfg.iaAtiva) {
                    const txtLimpoIA = texto.trim();
                    const ehValidoParaAprender =
                        txtLimpoIA.length >= 3 &&
                        txtLimpoIA.length <= 120 &&
                        !txtLimpoIA.includes('http') &&
                        !txtLimpoIA.includes('@') &&
                        !/^\d+$/.test(txtLimpoIA);

                    const ctxInfo = m.message.extendedTextMessage?.contextInfo;
                    const msgRespondida = ctxInfo?.quotedMessage?.conversation ||
                                          ctxInfo?.quotedMessage?.extendedTextMessage?.text || '';
                    const autorRespondido = ctxInfo?.participant || '';
                    const respondeuAoBot = mesmoUsuario(autorRespondido, botId) || (botLid && mesmoUsuario(autorRespondido, botLid));

                    if (ehValidoParaAprender) {
                        if (msgRespondida && !respondeuAoBot && msgRespondida.length >= 3 && msgRespondida.length <= 120 && !msgRespondida.startsWith(p)) {
                            const chavePergunta = msgRespondida.trim().toLowerCase();
                            if (!db.brain.pares[chavePergunta]) db.brain.pares[chavePergunta] = [];
                            if (!db.brain.pares[chavePergunta].includes(txtLimpoIA)) {
                                db.brain.pares[chavePergunta].push(txtLimpoIA);
                                if (db.brain.pares[chavePergunta].length > 15) db.brain.pares[chavePergunta].shift();
                                salvarDB(db);
                            }
                        } else if (!db.brain.soltas.includes(txtLimpoIA)) {
                            db.brain.soltas.push(txtLimpoIA);
                            if (db.brain.soltas.length > 300) db.brain.soltas.shift();
                            salvarDB(db);
                        }
                    }

                    const chamouHinata = txtLow.includes('hinata');
                    const sorteioChance = (Math.random() * 100) < (groupCfg.iaChance || 25);

                    if (respondeuAoBot || chamouHinata || sorteioChance) {
                        let possiveisRespostas = [];

                        if (db.brain.pares[txtLow]) {
                            possiveisRespostas = db.brain.pares[txtLow];
                        } else {
                            const chavesAprendidas = Object.keys(db.brain.pares);
                            const parecida = chavesAprendidas.find(k =>
                                (txtLow.length >= 4 && k.includes(txtLow)) ||
                                (k.length >= 4 && txtLow.includes(k))
                            );
                            if (parecida) possiveisRespostas = db.brain.pares[parecida];
                        }

                        if (possiveisRespostas.length === 0 && (respondeuAoBot || chamouHinata || Math.random() < 0.30)) {
                            possiveisRespostas = db.brain.soltas.filter(f => f.toLowerCase() !== txtLow);
                        }

                        if (possiveisRespostas.length > 0) {
                            const escolhida = possiveisRespostas[Math.floor(Math.random() * possiveisRespostas.length)];
                            return await sock.sendMessage(from, { text: escolhida }, { quoted: m });
                        } else if (chamouHinata) {
                            return await sock.sendMessage(from, { text: '🌸 Oi! Continue conversando no grupo para eu aprender novas falas com vocês!' }, { quoted: m });
                        }
                    }
                }
            }
            return;
        }

        const partes = texto.trim().slice(p.length).trim().split(/ +/);
        const cmd = partes[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const args = partes.slice(1);

        const user = obterUser(db, sender, pushName);
        salvarDB(db);

        // ==========================================
        // 0. MENU COMPLETO COM FOTO DA HINATA
        // ==========================================
        if (cmd === 'menu' || cmd === 'ajuda' || cmd === 'petmenu') {
            const totalFigs = fs.readdirSync(packDir).filter(f => f.endsWith('.webp')).length;
            const txt = [
                '🌸 *HINATA BOT - MENU* 🌸 (Prefixo: *' + p + '*)',
                '',
                '🧠 *INTELIGENCIA E APRENDIZADO:*',
                '├ *' + p + 'ia on/off* - Liga/desliga aprendizado de falas',
                '├ *' + p + 'ia chance <1-100>* - Chance de falar sozinha',
                '├ *' + p + 'cerebro* - Mostra quantas falas ja aprendeu',
                '└ *' + p + 'limparcerebro* - Reseta a memoria (Donos)',
                '',
                '🎭 *MENU DE BRINCADEIRAS:*',
                '├ *' + p + 'brincadeiras* - Abre o menu de zoeira',
                '├ *' + p + 'casal [@1] [@2]* - Forma casal no grupo 👩‍❤️‍👨',
                '├ *' + p + 'gado* | *' + p + 'gay* | *' + p + 'corno*',
                '└ *' + p + 'feio* | *' + p + 'gostosa* | *' + p + 'gostoso*',
                '',
                '💰 *ECONOMIA, CASSINO E BOMBA ATOMICA:*',
                '├ *' + p + 'gold* | *' + p + 'minerar* | *' + p + 'roubar* | *' + p + 'vinganca*',
                '├ *' + p + 'bomba <@user>* - ☢️ 1 Milhao (5% chance de ZERAR!)',
                '├ *' + p + 'tigrinho <valor>* - 🐯 Slot 3x3 (Max 10M)',
                '├ *' + p + 'apostar <valor>* - 🎰 Caca-niqueis (Max 10M)',
                '└ *' + p + 'loja* / *' + p + 'comprar <Nº>* - Loja de Gold',
                '',
                '🐾 *PETS VIRTUAIS (ADOCAO E CUIDADOS):*',
                '├ *' + p + 'adotar [Nº]* | *' + p + 'pet* | *' + p + 'petstatus*',
                '├ *' + p + 'alimentar* | *' + p + 'brincar* | *' + p + 'carinho*',
                '├ *' + p + 'banho* | *' + p + 'dormir* | *' + p + 'treinar*',
                '├ *' + p + 'petloja* | *' + p + 'petcomprar <Nº>* | *' + p + 'petinv*',
                '├ *' + p + 'petusar <item>* | *' + p + 'petrenomear <nome>*',
                '├ *' + p + 'petduelo* | *' + p + 'petvisitar* | *' + p + 'petpresente*',
                '├ *' + p + 'pettrocar* | *' + p + 'petcasal* | *' + p + 'petaceitar*',
                '└ *' + p + 'petranking* | *' + p + 'petcolecao* | *' + p + 'petevento*',
                '',
                '📥 *DOWNLOADS E FIGURINHAS:*',
                '├ *' + p + 'baixar <link>* - Escolher 1 (Video) ou 2 (Musica)',
                '├ *' + p + 's* | *' + p + 'ssom* (Figurinha c/ áudio 🔊)',
                '├ *' + p + 'addfig* | *' + p + 'fig <1-10>* (' + totalFigs + ' salvas)',
                '└ *' + p + 'velha [@user]* / *' + p + 'jogar <1-9>* - Jogo da Velha',
                '',
                '🛡️ *BOAS-VINDAS, AUTO-RESPOSTAS E MODERACAO:*',
                '├ *' + p + 'bv on/off* | *' + p + 'setbv <texto>* | *' + p + 'testbv*',
                '├ *' + p + 'addresp <gatilho> | <resposta>* - Cria fala fixa',
                '├ *' + p + 'delresp <gatilho>* | *' + p + 'listaresp*',
                '├ *' + p + 'antilink on/off* | *' + p + 'autoresp on/off* | *' + p + 'ban <@>*',
                '└ *' + p + 'donos* | *' + p + 'adddono* | *' + p + 'deldono* | *' + p + 'resetgold*'
            ].join('\n');

            try {
                if (fs.existsSync(menuImgPath)) {
                    return await sock.sendMessage(from, {
                        image: fs.readFileSync(menuImgPath),
                        caption: txt
                    }, { quoted: m });
                } else {
                    return await sock.sendMessage(from, {
                        image: { url: HINATA_URL_PADRAO },
                        caption: txt
                    }, { quoted: m });
                }
            } catch (e) {
                return responder(txt);
            }
        }

        // =========================================================================
        // 👋 BOAS-VINDAS, RESPOSTAS FIXAS E CONTROLE DO CEREBRO IA
        // =========================================================================
        if (cmd === 'bv' || cmd === 'bemvindo' || cmd === 'welcome') {
            if (!isGroup) return responder('⚠️ Este comando so funciona em grupos.');
            const { isSenderAdmin } = await verificarAdms();
            if (!isSenderAdmin) return responder('🔒 Apenas ADMs ou Donos podem configurar o Boas-Vindas.');

            const op = (args[0] || '').toLowerCase();
            if (op === 'on' || op === '1' || op === 'ligar') {
                groupCfg.welcome = true;
                salvarDB(db);
                return responder('🌸 *Boas-Vindas ATIVADO!* Sempre que alguem entrar no grupo, enviarei a mensagem de boas-vindas com a descricao oficial do grupo.');
            } else if (op === 'off' || op === '0' || op === 'desligar') {
                groupCfg.welcome = false;
                salvarDB(db);
                return responder('🔕 *Boas-Vindas DESATIVADO* neste grupo.');
            } else {
                const statusBv = groupCfg.welcome ? 'ATIVADO ✅' : 'DESATIVADO ❌';
                return responder(
                    `🌸 *Status do Boas-Vindas:* ${statusBv}\n\n` +
                    `• Para ligar/desligar: *${p}bv on* ou *${p}bv off*\n` +
                    `• Para adicionar um texto extra antes da descricao: *${p}setbv <texto>*\n` +
                    `• Para testar como ficou: *${p}testbv*`
                );
            }
        }

        if (cmd === 'setbv') {
            if (!isGroup) return responder('⚠️ Este comando so funciona em grupos.');
            const { isSenderAdmin } = await verificarAdms();
            if (!isSenderAdmin) return responder('🔒 Apenas ADMs ou Donos podem alterar o texto de boas-vindas.');

            const novoTxt = args.join(' ').trim();
            groupCfg.welcomeMsg = novoTxt;
            salvarDB(db);

            if (!novoTxt) {
                return responder('✅ Texto extra removido! O boas-vindas mostrara apenas a saudacao e a descricao do grupo.');
            }
            return responder(`✅ Texto extra de boas-vindas salvo!\n💬 *Mensagem:* "${novoTxt}"\n\nDigite *${p}testbv* para ver como vai aparecer quando alguem entrar!`);
        }

        if (cmd === 'testbv') {
            if (!isGroup) return responder('⚠️ Este comando so funciona em grupos.');
            const meta = await sock.groupMetadata(from);
            const nomeGrupo = meta.subject || 'Grupo';
            const descGrupo = meta.desc ? meta.desc.toString() : 'Sem descrição definida no grupo.';

            let linhasBv = [
                `🌸 *BEM-VINDO(A) AO ${nomeGrupo.toUpperCase()}!* 🌸`,
                '',
                `👋 Olá @${senderNum}, seja muito bem-vindo(a)!`
            ];
            if (groupCfg.welcomeMsg) {
                linhasBv.push('');
                linhasBv.push(`💬 ${groupCfg.welcomeMsg}`);
            }
            linhasBv.push('');
            linhasBv.push('📋 *DESCRIÇÃO / REGRAS DO GRUPO:*');
            linhasBv.push(descGrupo);
            linhasBv.push('');
            linhasBv.push(`🤖 Digite *${p}menu* para conhecer os comandos da Hinata Bot!`);

            return responder(linhasBv.join('\n'), [sender]);
        }

        if (cmd === 'addresp') {
            const { isSenderAdmin } = await verificarAdms();
            if (!isSenderAdmin) return responder('🔒 Apenas ADMs ou Donos podem adicionar respostas automaticas.');

            const conteudo = texto.trim().slice(p.length + cmd.length).trim();
            const divisor = conteudo.indexOf('|');

            if (divisor === -1) {
                return responder(
                    `⚠️ Use a barra *|* para separar a palavra-chave da resposta!\n\n` +
                    `📌 *Exemplo:*\n` +
                    `*${p}addresp bom dia grupo | Bom dia! Que seu dia seja incrivel!*`
                );
            }

            const gatilho = conteudo.slice(0, divisor).trim().toLowerCase();
            const resposta = conteudo.slice(divisor + 1).trim();

            if (!gatilho || !resposta) {
                return responder(`⚠️ Preencha a palavra e a resposta! Exemplo: *${p}addresp pix | Nossa chave pix e...*`);
            }

            groupCfg.customResps[gatilho] = resposta;
            salvarDB(db);

            return responder(
                `🗣️✅ *NOVA RESPOSTA AUTOMÁTICA SALVA!*\n\n` +
                `🎯 *Quando falarem:* "${gatilho}"\n` +
                `🌸 *Hinata vai responder:* "${resposta}"`
            );
        }

        if (cmd === 'delresp' || cmd === 'remresp') {
            const { isSenderAdmin } = await verificarAdms();
            if (!isSenderAdmin) return responder('🔒 Apenas ADMs ou Donos podem remover respostas automaticas.');

            const gatilho = args.join(' ').trim().toLowerCase();
            if (!gatilho || !groupCfg.customResps[gatilho]) {
                return responder(`⚠️ Gatilho nao encontrado! Digite *${p}listaresp* para ver todos os gatilhos cadastrados.`);
            }

            delete groupCfg.customResps[gatilho];
            salvarDB(db);
            return responder(`🗑️ A resposta automatica para *"${gatilho}"* foi removida!`);
        }

        if (cmd === 'listaresp' || cmd === 'respostas') {
            const chaves = Object.keys(groupCfg.customResps || {});
            if (chaves.length === 0) {
                return responder(`📭 Nenhuma resposta personalizada cadastrada ainda!\nUse *${p}addresp palavra | resposta* para criar.`);
            }

            let txt = ['🗣️ *RESPOSTAS AUTOMÁTICAS PERSONALIZADAS:*', ''];
            chaves.forEach((g, idx) => {
                txt.push(`*[ ${idx + 1} ]* 🎯 *"${g}"*`);
                txt.push(`└ 💬 ${groupCfg.customResps[g]}`);
            });
            txt.push('');
            txt.push(`🗑️ Para apagar uma, digite: *${p}delresp <palavra>*`);
            return responder(txt.join('\n'));
        }

        if (cmd === 'ia' || cmd === 'modofalante') {
            if (!isGroup) return responder('⚠️ Este comando so funciona em grupos.');
            const { isSenderAdmin } = await verificarAdms();
            if (!isSenderAdmin) return responder('🔒 Apenas ADMs ou Donos podem configurar a IA da Hinata.');

            const sub = (args[0] || '').toLowerCase();
            if (sub === 'on' || sub === '1' || sub === 'ligar') {
                groupCfg.iaAtiva = true;
                salvarDB(db);
                return responder(`🧠🌸 *Modo Aprendizado ATIVADO!* A Hinata vai aprender com as conversas do grupo e responder sozinha (${groupCfg.iaChance}% de chance).`);
            } else if (sub === 'off' || sub === '0' || sub === 'desligar') {
                groupCfg.iaAtiva = false;
                salvarDB(db);
                return responder('🤫 *Modo Aprendizado DESATIVADO* neste grupo.');
            } else if (sub === 'chance') {
                const novaChance = parseInt(args[1]);
                if (isNaN(novaChance) || novaChance < 1 || novaChance > 100) {
                    return responder(`⚠️ Digite uma porcentagem de 1 a 100! Exemplo: *${p}ia chance 30*`);
                }
                groupCfg.iaChance = novaChance;
                salvarDB(db);
                return responder(`🎲 A chance da Hinata responder sozinha foi ajustada para *${novaChance}%*!`);
            } else {
                const st = groupCfg.iaAtiva ? 'ATIVADO ✅' : 'DESATIVADO ❌';
                return responder(
                    `🧠 *IA DE APRENDIZADO DA HINATA*\n\n` +
                    `• Status: *${st}*\n` +
                    `• Chance de responder sozinha: *${groupCfg.iaChance}%*\n\n` +
                    `👉 Use *${p}ia on*, *${p}ia off* ou *${p}ia chance <1-100>*\n` +
                    `👉 Veja o que ela ja aprendeu com *${p}cerebro*`
                );
            }
        }

        if (cmd === 'cerebro' || cmd === 'memoria') {
            const totalPerguntas = Object.keys(db.brain?.pares || {}).length;
            const totalSoltas = (db.brain?.soltas || []).length;
            return responder(
                `🧠 *MEMÓRIA DA HINATA BOT* 🌸\n\n` +
                `├ 💬 Diálogos aprendidos (Pergunta ➔ Resposta): *${totalPerguntas}*\n` +
                `└ 🗣️ Frases soltas do grupo: *${totalSoltas}*\n\n` +
                `💡 _Quanto mais vocês conversarem e responderem mensagens uns dos outros no grupo, mais inteligente ela fica!_`
            );
        }

        if (cmd === 'limparcerebro' || cmd === 'resetia') {
            if (!isOwner) return responder('🔒 Apenas os Donos podem limpar a memória de aprendizado da Hinata.');
            db.brain = { pares: {}, soltas: [] };
            salvarDB(db);
            return responder('🧠🧹 *Memória limpa!* A Hinata esqueceu todas as falas antigas e começará a aprender do zero.');
        }

        // =========================================================================
        // 🎭 MENU DE BRINCADEIRAS
        // =========================================================================
        if (cmd === 'brincadeiras' || cmd === 'brincadeira' || cmd === 'zoeira') {
            const txt = [
                '🎭 *MENU DE BRINCADEIRAS - HINATA BOT* 🎭',
                '',
                '├ 👩‍❤️‍👨 *' + p + 'casal [@1] [@2]* - Sorteia ou mede um casal do grupo',
                '├ 🐮 *' + p + 'gado [@user]* - Calcula o nivel de gadice',
                '├ 🏳️‍🌈 *' + p + 'gay [@user]* - Calcula o nivel de gayzice',
                '├ 🐂 *' + p + 'corno [@user]* - Descobre o tamanho do chifre',
                '├ 🧌 *' + p + 'feio [@user]* - Mede o nivel de feiura',
                '├ 🔥 *' + p + 'gostosa [@user]* - Medidor de gostosura (ela)',
                '├ 💪 *' + p + 'gostoso [@user]* - Medidor de gostosura (ele)',
                '└ 🎮 *' + p + 'velha [@user]* - Desafia para o Jogo da Velha',
                '',
                '💡 _Use os comandos sozinho ou marcando/respondendo alguem do grupo!_'
            ].join('\n');
            return responder(txt);
        }

        if (cmd === 'casal' || cmd === 'ship') {
            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            let p1 = null;
            let p2 = null;

            if (menc.length >= 2) {
                p1 = menc[0];
                p2 = menc[1];
            } else if (menc.length === 1) {
                p1 = sender;
                p2 = menc[0];
            } else if (isGroup) {
                try {
                    const meta = await sock.groupMetadata(from);
                    const membros = meta.participants.map(x => x.id).filter(id => !mesmoUsuario(id, botId));
                    if (membros.length < 2) {
                        return responder('⚠️ Precisa de pelo menos 2 membros no grupo para formar um casal!');
                    }
                    const i1 = Math.floor(Math.random() * membros.length);
                    p1 = membros[i1];
                    const restantes = membros.filter(id => id !== p1);
                    p2 = restantes[Math.floor(Math.random() * restantes.length)];
                } catch (e) {
                    return responder('⚠️ Marque duas pessoas! Exemplo: *' + p + 'casal @pessoa1 @pessoa2*');
                }
            } else {
                return responder('⚠️ Use este comando em um grupo ou marque duas pessoas!');
            }

            const porc = Math.floor(Math.random() * 101);
            const barra = barraStatus(porc);
            let veredito = '';
            if (porc <= 30) {
                veredito = '💔 *Agua e oleo!* Melhor ficar so na amizade mesmo...';
            } else if (porc <= 70) {
                veredito = '👀🔥 *Tem quimica!* Uns beijos no escurinho ja rola!';
            } else {
                veredito = '💍👩‍❤️‍👨 *ALMAS GEMEAS!* Ja podem marcar o casamento e chamar o grupo!';
            }

            const msgCasal = [
                '💘 *CUPIDO DA HINATA BOT* 💘',
                '',
                `❤️ @${limparNum(p1)}  +  @${limparNum(p2)} ❤️`,
                '',
                `📊 *Chance de dar namoro:*`,
                `[ ${barra} ]`,
                '',
                `💬 ${veredito}`
            ].join('\n');

            return responder(msgCasal, [p1, p2]);
        }

        if (['gay', 'corno', 'feio', 'gostosa', 'gostoso', 'gado'].includes(cmd)) {
            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const resp = m.message.extendedTextMessage?.contextInfo?.participant;
            const alvoJid = menc[0] || resp || sender;
            const alvoNum = limparNum(alvoJid);
            const porc = Math.floor(Math.random() * 101);
            const barra = barraStatus(porc);

            const dadosBrincadeira = {
                gado: {
                    titulo: '🐮🔔 *DETECTOR DE GADO* 🔔🐮',
                    atributo: 'Gado(a)',
                    baixa: '🗿🍷 Frio e calculista! Nao manda nem bom dia se nao responderem primeiro.',
                    media: '🐮 Curte todos os stories e responde "linda" esperando migalhas!',
                    alta: '🐂🌾🚨 REI DO GADO! Paga lanche, faz Pix e ainda ouve desabafo sobre o ex dela(e)! Muuuuu!'
                },
                gay: {
                    titulo: '🏳️‍🌈 *DETECTOR DE GAYZICE* 🏳️‍🌈',
                    atributo: 'Gay',
                    baixa: '😎 Hetero raiz! Passou longe do arco-iris.',
                    media: '🤨 Hmmm... meio suspeito, ja deu uma olhadinha pro lado!',
                    alta: '💅✨ PURPURINA PURA! Rainha do camarote assumida!'
                },
                corno: {
                    titulo: '🐂 *DETECTOR DE CHIFRES* 🐂',
                    atributo: 'Corno(a)',
                    baixa: '🛡️ Cabeca limpa! Sem sinal de galhada ate o momento.',
                    media: '⚠️ Cuidado! Ja ta nascendo dois calombos na testa...',
                    alta: '🐂🎺 CORNO MANSO MASTER! Nao passa nem na porta sem abaixar a cabeca!'
                },
                feio: {
                    titulo: '🧌 *MEDIDOR DE FEIURA* 🧌',
                    atributo: 'Feio(a)',
                    baixa: '✨ Lindissimo(a)! Nem parece que acorda descabelado(a).',
                    media: '😬 Da pro gasto no escuro ou com filtro do Instagram!',
                    alta: '🧟‍♂️🚨 ASSUSTADOR! Quando nasceu o medico bateu na mae em vez do bebe!'
                },
                gostosa: {
                    titulo: '🔥💋 *MEDIDOR DE GOSTOSA* 💋🔥',
                    atributo: 'Gostosa',
                    baixa: '❄️ Fria como gelo, precisa de mais charme!',
                    media: '💃🔥 Gata demais! Ja faz o grupo inteiro suspirar!',
                    alta: '👑🔥🚨 DEUSA GREGA! Mulherao da porra, trava ate o WhatsApp!'
                },
                gostoso: {
                    titulo: '💪🔥 *MEDIDOR DE GOSTOSO* 🔥💪',
                    atributo: 'Gostoso',
                    baixa: '🦴 Magrelo de chassi de grilo, bora puxar ferro!',
                    media: '😏 Galã de novela! Ja arranca olhares por onde passa!',
                    alta: '🗿🍷🔥 DEUS GREGO! Shape inexplicavel, terror das solteiras!'
                }
            };

            const cfg = dadosBrincadeira[cmd];
            const fraseFinal = porc <= 30 ? cfg.baixa : (porc <= 70 ? cfg.media : cfg.alta);

            const msgBrincadeira = [
                cfg.titulo,
                '',
                `🎯 Alvo: @${alvoNum}`,
                `📊 Nivel de *${cfg.atributo}*:`,
                `[ ${barra} ]`,
                '',
                `💬 *Veredito:* ${fraseFinal}`
            ].join('\n');

            return responder(msgBrincadeira, [alvoJid]);
        }

        // =========================================================================
        // 🐾 1. SISTEMA DE ADOCAO E COLECAO
        // =========================================================================
        if (cmd === 'adotar') {
            const idEscolha = parseInt(args[0]);
            if (!idEscolha) {
                let txt = [
                    '🐾 *CENTRO DE ADOÇÃO DE PETS* 🐾',
                    '💰 Seu saldo: *' + user.gold.toLocaleString('pt-BR') + ' Gold*',
                    ''
                ];
                Object.values(CATALOGO_PETS).forEach(pet => {
                    txt.push(`*[ ${pet.id} ]* ${pet.emoji} *${pet.especie}* — *${pet.raridade}*`);
                    txt.push(`└ 💰 Preço: *${pet.preco.toLocaleString('pt-BR')} Gold* | ⚔️ Poder: *${pet.poder}x*`);
                });
                txt.push('');
                txt.push(`👉 Para adotar, digite: *${p}adotar <número>* (Ex: *${p}adotar 1*)`);
                return responder(txt.join('\n'));
            }

            const modelo = CATALOGO_PETS[idEscolha];
            if (!modelo) return responder(`⚠️ Número inválido! Digite *${p}adotar* para ver a lista de 1 a 10.`);
            if (user.gold < modelo.preco) {
                return responder(`💸 Saldo insuficiente! O *${modelo.emoji} ${modelo.especie}* custa *${modelo.preco.toLocaleString('pt-BR')} Gold* e você tem *${user.gold.toLocaleString('pt-BR')} Gold*.`);
            }

            const nomePersonalizado = args.slice(1).join(' ').trim() || modelo.especie;
            const novoPet = criarNovoPet(modelo, nomePersonalizado);

            user.gold -= modelo.preco;
            user.pets.push(novoPet);
            user.activePet = user.pets.length - 1;
            salvarDB(db);

            return responder([
                '🎉🐾 *NOVA ADOÇÃO REALIZADA!* 🐾🎉',
                '',
                `Você adotou um *${novoPet.emoji} ${novoPet.especie}* de raridade *${novoPet.raridade}*!`,
                `🏷️ Nome: *${novoPet.nome}*`,
                `💰 Saldo restante: *${user.gold.toLocaleString('pt-BR')} Gold*`,
                '',
                `Use *${p}pet* para ver seu bichinho e *${p}petrenomear <nome>* se quiser batizá-lo!`
            ].join('\n'));
        }

        if (cmd === 'petrenomear') {
            const pet = pegarPetAtivo(user);
            if (!pet) return responder(`⚠️ Você ainda não tem um pet! Use *${p}adotar* primeiro.`);
            const novoNome = args.join(' ').trim();
            if (!novoNome || novoNome.length > 25) {
                return responder(`⚠️ Digite um nome válido (até 25 letras).\nExemplo: *${p}petrenomear Kurama*`);
            }
            pet.nome = novoNome;
            salvarDB(db);
            return responder(`🏷️ O nome do seu *${pet.emoji} ${pet.especie}* foi alterado para *${pet.nome}*!`);
        }

        if (cmd === 'petcolecao') {
            if (!user.pets || user.pets.length === 0) {
                return responder(`🐾 Sua coleção está vazia! Adote seu primeiro companheiro com *${p}adotar*.`);
            }

            const escolha = parseInt(args[0]);
            if (escolha && escolha >= 1 && escolha <= user.pets.length) {
                user.activePet = escolha - 1;
                salvarDB(db);
                const pAtivo = pegarPetAtivo(user);
                return responder(`✅ Agora seu pet principal ativo é *${pAtivo.emoji} ${pAtivo.nome}* (Nível ${pAtivo.nivel})!`);
            }

            let txt = [`📚 *COLEÇÃO DE PETS DE ${pushName.toUpperCase()}* 📚`, ''];
            user.pets.forEach((pt, idx) => {
                const tagAtivo = idx === user.activePet ? ' ⭐ *(Ativo)*' : '';
                txt.push(`*[ ${idx + 1} ]* ${pt.emoji} *${pt.nome}* (${pt.especie} - ${pt.raridade})${tagAtivo}`);
                txt.push(`└ ⭐ Nível: *${pt.nivel}* (${obterFaseEvolucao(pt.nivel)}) | 🏆 Vitórias: *${pt.vitorias || 0}*`);
            });
            txt.push('');
            txt.push(`👉 Para trocar o pet ativo, digite: *${p}petcolecao <número>*`);
            return responder(txt.join('\n'));
        }

        // =========================================================================
        // 💗 2 & ⭐ 3. STATUS, EVOLUCAO E CUIDADOS
        // =========================================================================
        if (cmd === 'pet' || cmd === 'petstatus') {
            const pet = pegarPetAtivo(user);
            if (!pet) return responder(`⚠️ Você ainda não possui um pet! Digite *${p}adotar* para adotar o seu.`);
            salvarDB(db);

            const fase = obterFaseEvolucao(pet.nivel);
            const xpMax = pet.nivel * 100;
            const txt = [
                `${pet.emoji} *FICHA DO PET: ${pet.nome.toUpperCase()}* ${pet.acessorio || ''}`,
                `├ 🧬 Espécie: *${pet.especie}* (*${pet.raridade}*)`,
                `├ ⭐ Nível: *${pet.nivel}* (${fase})`,
                `├ 📈 XP: *${pet.xp} / ${xpMax}*`,
                `├ ⚔️ Multiplicador de Poder: *${pet.poder}x*`,
                `└ 🏆 Vitórias em Duelos: *${pet.vitorias || 0}*`,
                '',
                '💗 *ATRIBUTOS E NECESSIDADES:*',
                `├ ❤️ Fome: ${barraStatus(pet.fome)}`,
                `├ 😊 Felicidade: ${barraStatus(pet.felicidade)}`,
                `├ ⚡ Energia: ${barraStatus(pet.energia)}`,
                `├ 🧼 Higiene: ${barraStatus(pet.higiene)}`,
                `└ 💗 Saúde: ${barraStatus(pet.saude)}`,
                '',
                `💡 _Cuide dele com ${p}alimentar, ${p}brincar, ${p}carinho, ${p}banho, ${p}dormir e ${p}treinar!_`
            ].join('\n');
            return responder(txt);
        }

        if (cmd === 'alimentar') {
            const pet = pegarPetAtivo(user);
            if (!pet) return responder(`⚠️ Adote um pet primeiro com *${p}adotar*!`);

            const espera = checarCooldown(pet.cooldowns.alimentar, 2 * 60 * 1000);
            if (espera) return responder(`⏳ *${pet.nome}* ainda está mastigando! Aguarde *${espera}*.`);

            let usouItem = '';
            if (user.petInv.racao > 0) {
                user.petInv.racao -= 1;
                usouItem = 'usando *1x 🍖 Ração* do inventário';
            } else {
                if (user.gold < 40) return responder(`💸 Você está sem 🍖 Ração no inventário (*${p}petloja*) e precisa de pelo menos *40 Gold* para comprar comida avulsa!`);
                user.gold -= 40;
                usouItem = 'gastando *40 Gold* em comida fresca';
            }

            pet.fome = Math.min(100, pet.fome + 40);
            pet.saude = Math.min(100, pet.saude + 10);
            pet.cooldowns.alimentar = Date.now();
            const up = adicionarXpPet(pet, user, 25);
            salvarDB(db);

            return responder(`🍖 Você alimentou *${pet.emoji} ${pet.nome}* (${usouItem})!\n❤️ Fome: *${pet.fome}%* | 📈 *+25 XP*${up}`);
        }

        if (cmd === 'brincar') {
            const pet = pegarPetAtivo(user);
            if (!pet) return responder(`⚠️ Adote um pet primeiro com *${p}adotar*!`);

            const espera = checarCooldown(pet.cooldowns.brincar, 2 * 60 * 1000);
            if (espera) return responder(`⏳ Aguarde *${espera}* para brincar novamente.`);
            if (pet.energia < 15) return responder(`😴 *${pet.nome}* está exausto (${pet.energia}% de energia)! Use *${p}dormir* ou dê *🥛 Leite*.`);

            const bonusBrinquedo = user.petInv.brinquedo > 0 ? 15 : 0;
            pet.felicidade = Math.min(100, pet.felicidade + 30 + bonusBrinquedo);
            pet.energia = Math.max(0, pet.energia - 15);
            pet.fome = Math.max(0, pet.fome - 10);
            pet.cooldowns.brincar = Date.now();
            const up = adicionarXpPet(pet, user, 30);
            salvarDB(db);

            return responder(`🎾 Você brincou com *${pet.emoji} ${pet.nome}*!\n😊 Felicidade: *${pet.felicidade}%* | ⚡ Energia: *${pet.energia}%* | 📈 *+30 XP*${up}`);
        }

        if (cmd === 'carinho') {
            const pet = pegarPetAtivo(user);
            if (!pet) return responder(`⚠️ Adote um pet primeiro com *${p}adotar*!`);

            const espera = checarCooldown(pet.cooldowns.carinho, 1 * 60 * 1000);
            if (espera) return responder(`⏳ Aguarde *${espera}* para dar carinho de novo.`);

            pet.felicidade = Math.min(100, pet.felicidade + 20);
            pet.saude = Math.min(100, pet.saude + 5);
            pet.cooldowns.carinho = Date.now();
            const up = adicionarXpPet(pet, user, 15);
            salvarDB(db);

            return responder(`🥰 Você fez bastante carinho em *${pet.emoji} ${pet.nome}*!\n😊 Felicidade: *${pet.felicidade}%* | 💗 Saúde: *${pet.saude}%* | 📈 *+15 XP*${up}`);
        }

        if (cmd === 'banho') {
            const pet = pegarPetAtivo(user);
            if (!pet) return responder(`⚠️ Adote um pet primeiro com *${p}adotar*!`);

            const espera = checarCooldown(pet.cooldowns.banho, 3 * 60 * 1000);
            if (espera) return responder(`⏳ *${pet.nome}* já tomou banho recentemente! Aguarde *${espera}*.`);

            let bonusShampoo = 0;
            if (user.petInv.shampoo > 0) {
                user.petInv.shampoo -= 1;
                bonusShampoo = 15;
            }

            pet.higiene = 100;
            pet.saude = Math.min(100, pet.saude + 10 + bonusShampoo);
            pet.cooldowns.banho = Date.now();
            const up = adicionarXpPet(pet, user, 25);
            salvarDB(db);

            return responder(`🛁 *${pet.emoji} ${pet.nome}* tomou um banho quentinho e está cheiroso!\n🧼 Higiene: *100%* | 💗 Saúde: *${pet.saude}%* | 📈 *+25 XP*${up}`);
        }

        if (cmd === 'dormir') {
            const pet = pegarPetAtivo(user);
            if (!pet) return responder(`⚠️ Adote um pet primeiro com *${p}adotar*!`);

            const temCaminha = user.petInv.caminha > 0;
            const tempoRecarga = temCaminha ? (2 * 60 * 1000) : (4 * 60 * 1000);
            const espera = checarCooldown(pet.cooldowns.dormir, tempoRecarga);
            if (espera) return responder(`⏳ *${pet.nome}* ainda não está com sono! Aguarde *${espera}*.`);

            pet.energia = 100;
            pet.saude = Math.min(100, pet.saude + 10);
            pet.cooldowns.dormir = Date.now();
            const up = adicionarXpPet(pet, user, 20);
            salvarDB(db);

            const msgCama = temCaminha ? ' na sua *🛏️ Caminha Macia*' : '';
            return responder(`😴 *${pet.emoji} ${pet.nome}* tirou uma soneca revigorante${msgCama}!\n⚡ Energia: *100%* | 📈 *+20 XP*${up}`);
        }

        if (cmd === 'treinar') {
            const pet = pegarPetAtivo(user);
            if (!pet) return responder(`⚠️ Adote um pet primeiro com *${p}adotar*!`);

            const espera = checarCooldown(pet.cooldowns.treinar, 3 * 60 * 1000);
            if (espera) return responder(`⏳ *${pet.nome}* está recuperando o fôlego do último treino! Aguarde *${espera}*.`);

            if (pet.energia < 25 || pet.fome < 25) {
                return responder(`⚠️ *${pet.nome}* precisa de pelo menos *25% de Energia e Fome* para treinar! Use *${p}alimentar* e *${p}dormir*.`);
            }

            pet.energia -= 25;
            pet.fome -= 20;
            pet.higiene = Math.max(0, pet.higiene - 15);
            pet.cooldowns.treinar = Date.now();

            const xpGanho = Math.floor((Math.random() * 41) + 45);
            const up = adicionarXpPet(pet, user, xpGanho);
            salvarDB(db);

            return responder(`🏋️ *TREINO INTENSO!* *${pet.emoji} ${pet.nome}* treinou duro suas habilidades!\n📈 Ganhou: *+${xpGanho} XP*\n⚡ Energia: *${pet.energia}%* | ❤️ Fome: *${pet.fome}%*${up}`);
        }

        // =========================================================================
        // 🛍️ 4. LOJA EXCLUSIVA DOS PETS E INVENTARIO
        // =========================================================================
        if (cmd === 'petloja') {
            let txt = [
                '🛍️ *PET SHOP DA HINATA BOT* 🛍️',
                '💰 Seu saldo: *' + user.gold.toLocaleString('pt-BR') + ' Gold*',
                ''
            ];
            Object.values(LOJA_PETS).forEach(it => {
                txt.push(`*[ ${it.id} ]* ${it.emoji} *${it.nome}* — 💰 *${it.preco.toLocaleString('pt-BR')} Gold*`);
                txt.push(`└ _${it.desc}_`);
            });
            txt.push('');
            txt.push(`🛒 Para comprar: *${p}petcomprar <número> [qtd]* (Ex: *${p}petcomprar 1 3*)`);
            txt.push(`🎒 Para ver e usar seus itens: *${p}petinv* e *${p}petusar <item>*`);
            return responder(txt.join('\n'));
        }

        if (cmd === 'petcomprar') {
            const idItem = parseInt(args[0]);
            const qtd = Math.max(1, parseInt(args[1]) || 1);
            const item = LOJA_PETS[idItem];

            if (!item) return responder(`⚠️ Item inválido! Veja a lista de 1 a 7 digitando *${p}petloja*.`);
            const custoTotal = item.preco * qtd;
            if (user.gold < custoTotal) {
                return responder(`💸 Saldo insuficiente! *${qtd}x ${item.emoji} ${item.nome}* custa *${custoTotal.toLocaleString('pt-BR')} Gold*.`);
            }

            user.gold -= custoTotal;
            user.petInv[item.key] = (user.petInv[item.key] || 0) + qtd;
            salvarDB(db);

            return responder(`✅ Você comprou *${qtd}x ${item.emoji} ${item.nome}* por *${custoTotal.toLocaleString('pt-BR')} Gold*!\nUse *${p}petinv* para ver seu inventário ou *${p}petusar ${item.key}* para aplicar no seu pet.`);
        }

        if (cmd === 'petinv') {
            const inv = user.petInv;
            const txt = [
                `🎒 *INVENTÁRIO PET DE ${pushName.toUpperCase()}* 🎒`,
                '',
                `🍖 Ração (*racao*): *${inv.racao || 0}x*`,
                `🥛 Leite (*leite*): *${inv.leite || 0}x*`,
                `🧸 Brinquedos (*brinquedo*): *${inv.brinquedo || 0}x*`,
                `🧴 Shampoo (*shampoo*): *${inv.shampoo || 0}x*`,
                `🛏️ Caminha (*caminha*): *${inv.caminha || 0}x*`,
                `🎀 Acessórios (*acessorio*): *${inv.acessorio || 0}x*`,
                `🦴 Osso Mágico (*osso*): *${inv.osso || 0}x*`,
                '',
                `👉 Para usar um item no seu pet ativo, digite:`,
                `*${p}petusar <nome>* (Ex: *${p}petusar leite*, *${p}petusar osso*, *${p}petusar acessorio*)`
            ].join('\n');
            return responder(txt);
        }

        if (cmd === 'petusar') {
            const pet = pegarPetAtivo(user);
            if (!pet) return responder(`⚠️ Você precisa de um pet ativo! Use *${p}adotar*.`);
            const escolha = (args[0] || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

            if (!escolha) return responder(`⚠️ Informe o item que deseja usar!\nExemplo: *${p}petusar racao*, *${p}petusar leite*, *${p}petusar osso*, *${p}petusar acessorio*`);

            if (escolha === 'racao' || escolha === '1') {
                if (!user.petInv.racao) return responder(`⚠️ Você não tem 🍖 Ração! Compre na *${p}petloja*.`);
                user.petInv.racao -= 1;
                pet.fome = Math.min(100, pet.fome + 45);
                pet.saude = Math.min(100, pet.saude + 10);
                const up = adicionarXpPet(pet, user, 25);
                salvarDB(db);
                return responder(`🍖 *${pet.emoji} ${pet.nome}* comeu a Ração Premium! ❤️ Fome: *${pet.fome}%*${up}`);
            }
            if (escolha === 'leite' || escolha === '2') {
                if (!user.petInv.leite) return responder(`⚠️ Você não tem 🥛 Leite! Compre na *${p}petloja*.`);
                user.petInv.leite -= 1;
                pet.energia = Math.min(100, pet.energia + 40);
                pet.fome = Math.min(100, pet.fome + 15);
                const up = adicionarXpPet(pet, user, 20);
                salvarDB(db);
                return responder(`🥛 *${pet.emoji} ${pet.nome}* tomou Leite Fresco! ⚡ Energia: *${pet.energia}%*${up}`);
            }
            if (escolha === 'brinquedo' || escolha === '3') {
                if (!user.petInv.brinquedo) return responder(`⚠️ Você não tem 🧸 Brinquedos! Compre na *${p}petloja*.`);
                user.petInv.brinquedo -= 1;
                pet.felicidade = Math.min(100, pet.felicidade + 50);
                const up = adicionarXpPet(pet, user, 35);
                salvarDB(db);
                return responder(`🧸 *${pet.emoji} ${pet.nome}* adorou o Brinquedo novo! 😊 Felicidade: *${pet.felicidade}%*${up}`);
            }
            if (escolha === 'shampoo' || escolha === '4') {
                if (!user.petInv.shampoo) return responder(`⚠️ Você não tem 🧴 Shampoo! Compre na *${p}petloja*.`);
                user.petInv.shampoo -= 1;
                pet.higiene = 100;
                pet.saude = Math.min(100, pet.saude + 20);
                const up = adicionarXpPet(pet, user, 30);
                salvarDB(db);
                return responder(`🧴 *${pet.emoji} ${pet.nome}* ficou brilhando com o Shampoo Pet! 🧼 Higiene: *100%*${up}`);
            }
            if (escolha === 'osso' || escolha === '7') {
                if (!user.petInv.osso) return responder(`⚠️ Você não tem 🦴 Osso Mágico! Compre na *${p}petloja*.`);
                user.petInv.osso -= 1;
                const up = adicionarXpPet(pet, user, 150);
                salvarDB(db);
                return responder(`🦴✨ *${pet.emoji} ${pet.nome}* absorveu a energia do Osso Mágico e ganhou *+150 XP*!${up}`);
            }
            if (escolha === 'acessorio' || escolha === '6') {
                if (!user.petInv.acessorio) return responder(`⚠️ Você não tem 🎀 Acessório! Compre na *${p}petloja*.`);
                user.petInv.acessorio -= 1;
                const opcoes = ['🎀', '👑', '🕶️', '🧣', '🎩'];
                pet.acessorio = opcoes[Math.floor(Math.random() * opcoes.length)];
                pet.poder = Number((pet.poder + 0.15).toFixed(2));
                salvarDB(db);
                return responder(`🎀 Você equipou o acessório *${pet.acessorio}* em *${pet.emoji} ${pet.nome}*! O multiplicador de poder dele subiu para *${pet.poder}x*!`);
            }
            return responder(`⚠️ Item não reconhecido. Use: *racao, leite, brinquedo, shampoo, acessorio* ou *osso*.`);
        }

        // =========================================================================
        // ⚔️ 5 & 🐣 6. INTERACAO ENTRE PETS E CRUZAMENTO
        // =========================================================================
        if (cmd === 'petvisitar') {
            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const resp = m.message.extendedTextMessage?.contextInfo?.participant;
            const alvoJid = menc[0] || resp;
            if (!alvoJid) return responder(`⚠️ Marque alguém para visitar o pet! Exemplo: *${p}petvisitar @amigo*`);

            const alvoUser = obterUser(db, alvoJid);
            const alvoPet = pegarPetAtivo(alvoUser);
            if (!alvoPet) return responder(`😢 @${limparNum(alvoJid)} ainda não adotou nenhum pet!`, [alvoJid]);

            alvoPet.felicidade = Math.min(100, alvoPet.felicidade + 10);
            salvarDB(db);

            return responder([
                `🏡 *VISITA AO PET DE @${limparNum(alvoJid)}*`,
                '',
                `${alvoPet.emoji} *${alvoPet.nome}* ${alvoPet.acessorio || ''} (${alvoPet.especie} - *${alvoPet.raridade}*)`,
                `⭐ Nível: *${alvoPet.nivel}* (${obterFaseEvolucao(alvoPet.nivel)}) | 🏆 Vitórias: *${alvoPet.vitorias || 0}*`,
                `❤️ Fome: *${alvoPet.fome}%* | 😊 Felicidade: *${alvoPet.felicidade}%* | 💗 Saúde: *${alvoPet.saude}%*`,
                '',
                `✨ _Sua visita deixou ${alvoPet.nome} mais feliz (+10% Felicidade)!_`
            ].join('\n'), [alvoJid]);
        }

        if (cmd === 'petduelo') {
            const pet = pegarPetAtivo(user);
            if (!pet) return responder(`⚠️ Você precisa de um pet para duelar! Use *${p}adotar*.`);

            const espera = checarCooldown(pet.cooldowns.duelo, 2 * 60 * 1000);
            if (espera) return responder(`⏳ Seu pet está descansando da última batalha! Aguarde *${espera}*.`);
            if (pet.energia < 20 || pet.saude < 30) {
                return responder(`⚠️ *${pet.nome}* está fraco demais para duelar! Cuide da Energia e Saúde dele primeiro.`);
            }

            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const resp = m.message.extendedTextMessage?.contextInfo?.participant;
            const alvoJid = menc[0] || resp;
            if (!alvoJid || alvoJid === sender) return responder(`⚠️ Marque um oponente válido! Exemplo: *${p}petduelo @usuario*`);

            const opUser = obterUser(db, alvoJid);
            const opPet = pegarPetAtivo(opUser);
            if (!opPet) return responder(`⚠️ @${limparNum(alvoJid)} não possui nenhum pet para batalhar!`, [alvoJid]);

            pet.cooldowns.duelo = Date.now();
            pet.energia = Math.max(0, pet.energia - 20);

            const scoreMeu = ((pet.nivel * 15) + ((pet.felicidade + pet.saude + pet.fome) * 0.2)) * pet.poder * (0.85 + Math.random() * 0.3);
            const scoreOp = ((opPet.nivel * 15) + ((opPet.felicidade + opPet.saude + opPet.fome) * 0.2)) * opPet.poder * (0.85 + Math.random() * 0.3);

            const vencedorSouEu = scoreMeu >= scoreOp;
            const winUser = vencedorSouEu ? user : opUser;
            const winPet = vencedorSouEu ? pet : opPet;
            const winJid = vencedorSouEu ? sender : alvoJid;
            const losePet = vencedorSouEu ? opPet : pet;

            const premioGold = Math.floor(250 + (winPet.nivel * 40));
            winPet.vitorias = (winPet.vitorias || 0) + 1;
            winUser.gold += premioGold;
            const up = adicionarXpPet(winPet, winUser, 60);
            adicionarXpPet(losePet, vencedorSouEu ? opUser : user, 15);
            salvarDB(db);

            return responder([
                '⚔️🏟️ *ARENA DE DUELO PET!* 🏟️⚔️',
                '',
                `🔵 @${senderNum}: *${pet.emoji} ${pet.nome}* (Nv.${pet.nivel} | Poder ${Math.round(scoreMeu)})`,
                `🔴 @${limparNum(alvoJid)}: *${opPet.emoji} ${opPet.nome}* (Nv.${opPet.nivel} | Poder ${Math.round(scoreOp)})`,
                '',
                `🏆 *VENCEDOR:* *${winPet.emoji} ${winPet.nome}* de @${limparNum(winJid)}!`,
                `💰 Prêmio da Arena: *+${premioGold.toLocaleString('pt-BR')} Gold* e *+60 XP*!${up}`
            ].join('\n'), [sender, alvoJid]);
        }

        if (cmd === 'petpresente') {
            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const resp = m.message.extendedTextMessage?.contextInfo?.participant;
            const alvoJid = menc[0] || resp;
            if (!alvoJid || alvoJid === sender) return responder(`⚠️ Marque quem vai receber o presente! Ex: *${p}petpresente @user racao*`);

            const itemKey = (args.find(a => !a.startsWith('@')) || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const itemObj = Object.values(LOJA_PETS).find(i => i.key === itemKey || String(i.id) === itemKey);

            if (!itemObj) return responder(`⚠️ Informe um item válido (*racao, leite, brinquedo, shampoo, caminha, acessorio, osso*).`);
            if (!user.petInv[itemObj.key] || user.petInv[itemObj.key] <= 0) {
                return responder(`⚠️ Você não possui *${itemObj.emoji} ${itemObj.nome}* no seu inventário!`);
            }

            solicitacoesPet[alvoJid] = {
                tipo: 'presente',
                deJid: sender,
                itemKey: itemObj.key,
                itemNome: `${itemObj.emoji} ${itemObj.nome}`,
                expira: Date.now() + 120000
            };

            return responder([
                `🎁 *PRESENTE PET ENVIADO!*`,
                `@${senderNum} quer enviar *1x ${itemObj.emoji} ${itemObj.nome}* para @${limparNum(alvoJid)}!`,
                '',
                `👉 @${limparNum(alvoJid)}, digite *${p}petaceitar* para receber ou *${p}petrecusar* (expira em 2 min).`
            ].join('\n'), [sender, alvoJid]);
        }

        if (cmd === 'pettrocar') {
            const meuPet = pegarPetAtivo(user);
            if (!meuPet) return responder(`⚠️ Você precisa ter um pet ativo para propor uma troca!`);

            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const resp = m.message.extendedTextMessage?.contextInfo?.participant;
            const alvoJid = menc[0] || resp;
            if (!alvoJid || alvoJid === sender) return responder(`⚠️ Marque o usuário com quem deseja trocar! Ex: *${p}pettrocar @user*`);

            const alvoUser = obterUser(db, alvoJid);
            const alvoPet = pegarPetAtivo(alvoUser);
            if (!alvoPet) return responder(`⚠️ @${limparNum(alvoJid)} não tem nenhum pet ativo para trocar!`, [alvoJid]);

            solicitacoesPet[alvoJid] = {
                tipo: 'troca',
                deJid: sender,
                expira: Date.now() + 120000
            };

            return responder([
                `🔄 *SOLICITAÇÃO DE TROCA DE PETS!*`,
                '',
                `@${senderNum} propôs trocar:`,
                `👉 *${meuPet.emoji} ${meuPet.nome}* (${meuPet.especie} - ${meuPet.raridade} - Nv.${meuPet.nivel})`,
                `Pelo pet de @${limparNum(alvoJid)}:`,
                `👉 *${alvoPet.emoji} ${alvoPet.nome}* (${alvoPet.especie} - ${alvoPet.raridade} - Nv.${alvoPet.nivel})`,
                '',
                `✅ @${limparNum(alvoJid)}, digite *${p}petaceitar* para confirmar a troca ou *${p}petrecusar* para cancelar!`
            ].join('\n'), [sender, alvoJid]);
        }

        if (cmd === 'petcasal') {
            const meuPet = pegarPetAtivo(user);
            if (!meuPet) return responder(`⚠️ Você precisa de um pet ativo! Use *${p}adotar*.`);
            if (meuPet.nivel < 6) return responder(`⚠️ Seu pet precisa ser pelo menos *Nível 6 (Jovem)* para cruzar!`);

            const espera = checarCooldown(meuPet.cooldowns.casal, 15 * 60 * 1000);
            if (espera) return responder(`⏳ Seu pet precisa descansar *${espera}* antes de outro cruzamento.`);

            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const resp = m.message.extendedTextMessage?.contextInfo?.participant;
            const alvoJid = menc[0] || resp;
            if (!alvoJid || alvoJid === sender) return responder(`⚠️ Marque o dono do pet parceiro! Ex: *${p}petcasal @user*`);

            const alvoUser = obterUser(db, alvoJid);
            const alvoPet = pegarPetAtivo(alvoUser);
            if (!alvoPet) return responder(`⚠️ @${limparNum(alvoJid)} não tem um pet ativo!`, [alvoJid]);
            if (alvoPet.nivel < 6) return responder(`⚠️ O pet de @${limparNum(alvoJid)} também precisa estar no mínimo no *Nível 6*!`, [alvoJid]);

            solicitacoesPet[alvoJid] = {
                tipo: 'casal',
                deJid: sender,
                expira: Date.now() + 120000
            };

            return responder([
                `🐣💕 *PEDIDO DE CRUZAMENTO PET!* 💕🐣`,
                '',
                `@${senderNum} (*${meuPet.emoji} ${meuPet.nome}*) quer cruzar seu pet com o de @${limparNum(alvoJid)} (*${alvoPet.emoji} ${alvoPet.nome}*) para gerar um filhote!`,
                '',
                `✅ @${limparNum(alvoJid)}, digite *${p}petaceitar* para autorizar o cruzamento ou *${p}petrecusar*!`
            ].join('\n'), [sender, alvoJid]);
        }

        if (cmd === 'petaceitar' || cmd === 'petrecusar') {
            const req = solicitacoesPet[sender];
            if (!req || Date.now() > req.expira) {
                delete solicitacoesPet[sender];
                return responder(`⚠️ Você não tem nenhuma solicitação de pet pendente (ou ela já expirou).`);
            }

            const remJid = req.deJid;
            const remUser = obterUser(db, remJid);
            delete solicitacoesPet[sender];

            if (cmd === 'petrecusar') {
                return responder(`❌ @${senderNum} recusou a solicitação de @${limparNum(remJid)}.`, [sender, remJid]);
            }

            if (req.tipo === 'presente') {
                if (!remUser.petInv[req.itemKey] || remUser.petInv[req.itemKey] <= 0) {
                    return responder(`⚠️ O remetente não possui mais o item no inventário!`);
                }
                remUser.petInv[req.itemKey] -= 1;
                user.petInv[req.itemKey] = (user.petInv[req.itemKey] || 0) + 1;
                salvarDB(db);
                return responder(`🎁✅ @${senderNum} aceitou o presente e recebeu *1x ${req.itemNome}* de @${limparNum(remJid)}!`, [sender, remJid]);
            }

            if (req.tipo === 'troca') {
                const petA = pegarPetAtivo(remUser);
                const petB = pegarPetAtivo(user);
                if (!petA || !petB) return responder(`⚠️ Um dos jogadores não está mais com o pet ativo.`);

                remUser.pets[remUser.activePet] = petB;
                user.pets[user.activePet] = petA;
                salvarDB(db);

                return responder([
                    `🔄🎉 *TROCA DE PETS CONCLUÍDA!* 🎉🔄`,
                    '',
                    `• @${limparNum(remJid)} agora cuida de *${petB.emoji} ${petB.nome}*!`,
                    `• @${senderNum} agora cuida de *${petA.emoji} ${petA.nome}*!`
                ].join('\n'), [sender, remJid]);
            }

            if (req.tipo === 'casal') {
                const petA = pegarPetAtivo(remUser);
                const petB = pegarPetAtivo(user);
                if (!petA || !petB) return responder(`⚠️ Ambos precisam estar com seus pets ativos!`);

                petA.cooldowns.casal = Date.now();
                petB.cooldowns.casal = Date.now();

                let modeloFilhote = Math.random() < 0.5 ? CATALOGO_PETS[petA.idEspecie || 1] : CATALOGO_PETS[petB.idEspecie || 2];
                if (Math.random() < 0.20) {
                    const raros = Object.values(CATALOGO_PETS).filter(x => x.id >= 6);
                    modeloFilhote = raros[Math.floor(Math.random() * raros.length)];
                }

                const filhoteA = criarNovoPet(modeloFilhote, `${modeloFilhote.especie} Jr`);
                const filhoteB = criarNovoPet(modeloFilhote, `${modeloFilhote.especie} Jr`);
                remUser.pets.push(filhoteA);
                user.pets.push(filhoteB);
                salvarDB(db);

                return responder([
                    `🐣🎉 *NASCEU UM FILHOTE!* 🎉🐣`,
                    '',
                    `O cruzamento entre *${petA.emoji} ${petA.nome}* e *${petB.emoji} ${petB.nome}* foi um sucesso!`,
                    `Ambos os donos (@${limparNum(remJid)} e @${senderNum}) receberam um filhote de *${modeloFilhote.emoji} ${modeloFilhote.especie}* (*${modeloFilhote.raridade}*) na sua *${p}petcolecao*!`
                ].join('\n'), [sender, remJid]);
            }
        }

        // =========================================================================
        // 🏆 7 & 👑 8. EVENTOS, COMPETICOES E RANKING DE PETS
        // =========================================================================
        if (cmd === 'petranking' || cmd === 'petrank') {
            const todosPets = [];
            Object.entries(db.users).forEach(([jid, u]) => {
                if (u.pets && u.pets.length > 0) {
                    u.pets.forEach(pt => {
                        todosPets.push({
                            jid,
                            donoNome: u.name || limparNum(jid),
                            pet: pt,
                            pontuacao: (pt.nivel * 1000) + pt.xp + ((pt.vitorias || 0) * 300)
                        });
                    });
                }
            });

            if (todosPets.length === 0) {
                return responder(`🐾 Nenhum pet foi adotado ainda! Seja o primeiro usando *${p}adotar*.`);
            }

            todosPets.sort((a, b) => b.pontuacao - a.pontuacao);
            const top10 = todosPets.slice(0, 10);

            let txt = ['👑 *RANKING MUNDIAL DE PETS* 👑', ''];
            const mentions = [];
            top10.forEach((item, idx) => {
                const med = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}º`;
                const num = limparNum(item.jid);
                txt.push(`${med} *${item.pet.emoji} ${item.pet.nome}* (${item.pet.raridade}) — @${num}`);
                txt.push(`└ ⭐ Nível *${item.pet.nivel}* | 🏆 *${item.pet.vitorias || 0}* vitórias`);
                if (!mentions.includes(item.jid)) mentions.push(item.jid);
            });
            return responder(txt.join('\n'), mentions);
        }

        if (cmd === 'petevento') {
            if (!isOwner) {
                if (!eventoPetAtivo) {
                    return responder(`🎪 Nenhum evento de Pet ativo no momento! Peça para um dos Donos iniciar com *${p}petevento*.`);
                }
                return responder(`🎪 *EVENTO ATIVO:* ${eventoPetAtivo.titulo}\n👉 Digite *${p}petcapturar* para resgatar antes que acabe!`);
            }

            const tiposEventos = [
                {
                    tipo: 'racao',
                    titulo: '🍖 CAÇA À RAÇÃO E SUPRIMENTOS!',
                    desc: 'Um caminhão do Pet Shop tombou no grupo! O primeiro que digitar ganha *5x 🍖 Ração + 3x 🥛 Leite + 1.500 Gold*!'
                },
                {
                    tipo: 'item_raro',
                    titulo: '💎 CAÇA AOS ITENS RAROS!',
                    desc: 'Um baú brilhante apareceu! O primeiro a capturar ganha *2x 🦴 Osso Mágico + 1x 🎀 Acessório Real*!'
                },
                {
                    tipo: 'lendario',
                    titulo: '🐉 APARIÇÃO DE ANIMAL LENDÁRIO!',
                    desc: 'Um *🐉 Dragão Lendário Selvagem* apareceu no chat! O primeiro a capturar adota ele gratuitamente na coleção!'
                },
                {
                    tipo: 'campeonato',
                    titulo: '🏆 CAMPEONATO RELÂMPAGO DE PETS!',
                    desc: 'Inscrição aberta! O primeiro treinador com pet ativo que capturar leva o troféu de *+5.000 Gold e +200 XP*!'
                }
            ];

            const sorteado = tiposEventos[Math.floor(Math.random() * tiposEventos.length)];
            eventoPetAtivo = {
                ...sorteado,
                criadoEm: Date.now()
            };

            return responder([
                '🚨🎪 *EVENTO ESPECIAL DE PETS INICIADO!* 🎪🚨',
                '',
                `*${sorteado.titulo}*`,
                sorteado.desc,
                '',
                `🏃‍♂️💨 Seja o mais rápido e digite: *${p}petcapturar*`
            ].join('\n'));
        }

        if (cmd === 'petcapturar') {
            if (!eventoPetAtivo) {
                return responder(`⚠️ Não há nenhum evento ativo agora ou alguém já capturou antes de você!`);
            }

            const ev = eventoPetAtivo;
            eventoPetAtivo = null;

            if (ev.tipo === 'racao') {
                user.petInv.racao = (user.petInv.racao || 0) + 5;
                user.petInv.leite = (user.petInv.leite || 0) + 3;
                user.gold += 1500;
                salvarDB(db);
                return responder(`🎉🍖 @${senderNum} foi o mais rápido na *Caça à Ração* e ganhou *5x Ração, 3x Leite e +1.500 Gold*!`, [sender]);
            }

            if (ev.tipo === 'item_raro') {
                user.petInv.osso = (user.petInv.osso || 0) + 2;
                user.petInv.acessorio = (user.petInv.acessorio || 0) + 1;
                salvarDB(db);
                return responder(`🎉💎 @${senderNum} abriu o baú da *Caça aos Itens Raros* e ganhou *2x 🦴 Osso Mágico e 1x 🎀 Acessório Real*!`, [sender]);
            }

            if (ev.tipo === 'lendario') {
                const dragao = criarNovoPet(CATALOGO_PETS[9], 'Dragão Celestial');
                user.pets.push(dragao);
                user.activePet = user.pets.length - 1;
                salvarDB(db);
                return responder(`🎉🐉 *CAPTURA LENDÁRIA!* @${senderNum} capturou o *🐉 Dragão Celestial (Lendário)* gratuitamente! Veja com *${p}pet*!`, [sender]);
            }

            if (ev.tipo === 'campeonato') {
                const pet = pegarPetAtivo(user);
                if (!pet) {
                    user.gold += 2000;
                    salvarDB(db);
                    return responder(`🏆 @${senderNum} venceu o evento mas não tinha pet ativo, levando *+2.000 Gold* de consolação!`, [sender]);
                }
                user.gold += 5000;
                pet.vitorias = (pet.vitorias || 0) + 1;
                const up = adicionarXpPet(pet, user, 200);
                salvarDB(db);
                return responder(`🏆🎖️ *CAMPEÃO DO TORNEIO!* @${senderNum} e seu pet *${pet.emoji} ${pet.nome}* venceram o campeonato e ganharam *+5.000 Gold e +200 XP*!${up}`, [sender]);
            }
        }

        // ==========================================
        // MODERACAO CORRIGIDA (BAN E ANTILINK)
        // ==========================================
        if (cmd === 'autoresp') {
            const { isSenderAdmin } = await verificarAdms();
            if (!isSenderAdmin) return responder('🔒 Apenas ADMs ou os Donos podem alterar a resposta automatica.');
            const op = (args[0] || '').toLowerCase();
            if (op === 'on' || op === '1') {
                groupCfg.autoResp = true;
                salvarDB(db);
                return responder('🗣️ *Respostas automaticas ATIVADAS!*');
            } else if (op === 'off' || op === '0') {
                groupCfg.autoResp = false;
                salvarDB(db);
                return responder('🤫 *Respostas automaticas DESATIVADAS!*');
            } else {
                return responder('Use *' + p + 'autoresp on* ou *' + p + 'autoresp off*');
            }
        }

        if (cmd === 'antilink') {
            if (!isGroup) return responder('⚠️ Este comando so funciona dentro de grupos.');
            const { isSenderAdmin } = await verificarAdms();
            if (!isSenderAdmin) return responder('🔒 Apenas ADMs do grupo ou os Donos podem configurar o Anti-Link.');

            const opcao = (args[0] || '').toLowerCase();
            if (opcao === 'on' || opcao === 'ligar' || opcao === '1') {
                groupCfg.antilink = true;
                salvarDB(db);
                return responder('🛡️ *Anti-Link ATIVADO!* Membros comuns que enviarem links serao banidos.');
            } else if (opcao === 'off' || opcao === 'desligar' || opcao === '0') {
                groupCfg.antilink = false;
                salvarDB(db);
                return responder('🔓 *Anti-Link DESATIVADO* neste grupo.');
            } else {
                const statusAtual = groupCfg.antilink ? 'ATIVADO ✅' : 'DESATIVADO ❌';
                return responder('🛡️ Status do Anti-Link: *' + statusAtual + '*\nUse *' + p + 'antilink on* ou *' + p + 'antilink off*.');
            }
        }

        if (cmd === 'ban' || cmd === 'kick' || cmd === 'banir') {
            if (!isGroup) return responder('⚠️ Este comando so funciona em grupos.');
            const { isSenderAdmin } = await verificarAdms();
            if (!isSenderAdmin) return responder('🔒 Apenas ADMs ou os Donos podem banir membros.');

            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const resp = m.message.extendedTextMessage?.contextInfo?.participant;
            const alvoJid = menc[0] || resp;

            if (!alvoJid) return responder('⚠️ Marque o membro ou responda a mensagem dele com *' + p + 'ban*');

            const alvoNum = limparNum(alvoJid);
            if (mesmoUsuario(alvoJid, botId) || (botLid && mesmoUsuario(alvoJid, botLid)) || db.owners.some(o => mesmoUsuario(alvoJid, o))) {
                return responder('👑 Nao posso banir um dos Donos nem a mim mesma!');
            }

            try {
                await sock.groupParticipantsUpdate(from, [alvoJid], 'remove');
                return responder('🔨 @' + alvoNum + ' foi banido do grupo com sucesso!', [alvoJid]);
            } catch (e) {
                return responder('❌ O WhatsApp recusou a remocao! Verifique se o numero da Hinata Bot esta realmente promovido como *Administrador do grupo*.');
            }
        }

        // ==========================================
        // LOJA DE GOLD PRINCIPAL
        // ==========================================
        if (cmd === 'loja' || cmd === 'shop') {
            let txt = [
                '🏪 *LOJA DE GOLD - HINATA BOT* 🏪',
                '💰 Seu saldo: *' + user.gold.toLocaleString('pt-BR') + ' Gold*',
                '⛏️ Multiplicador: *' + user.pickaxe + 'x* | 🛡️ Escudos: *' + user.shields + '*',
                ''
            ];
            Object.values(ITENS_LOJA).forEach(item => {
                txt.push('*[' + item.id + '] ' + item.nome + '* — 💰 *' + item.preco.toLocaleString('pt-BR') + ' Gold*');
                txt.push('└ _' + item.desc + '_');
            });
            txt.push('');
            txt.push('🛒 Para comprar, digite: *' + p + 'comprar <numero>*');
            txt.push('🐾 Para ver a loja de Pets, digite: *' + p + 'petloja*');
            return responder(txt.join('\n'));
        }

        if (cmd === 'comprar' || cmd === 'buy') {
            const idItem = parseInt(args[0]);
            const item = ITENS_LOJA[idItem];

            if (!item) return responder('⚠️ Item invalido! Veja os numeros digitando *' + p + 'loja*');
            if (user.gold < item.preco) {
                return responder('💸 Saldo insuficiente! Voce tem *' + user.gold.toLocaleString('pt-BR') + ' Gold* e precisa de *' + item.preco.toLocaleString('pt-BR') + ' Gold*.');
            }

            if (item.tipo === 'pickaxe') {
                if (user.pickaxe >= item.nivel) return responder('⚠️ Voce ja possui uma picareta igual ou superior!');
                user.gold -= item.preco;
                user.pickaxe = item.nivel;
                salvarDB(db);
                return responder('✅ Agora voce tem a *' + item.nome + '* e ganha *' + item.nivel + 'x mais Gold* ao minerar!');
            }
            if (item.tipo === 'shield') {
                user.gold -= item.preco;
                user.shields += 1;
                salvarDB(db);
                return responder('🛡️ Voce comprou um *Escudo Anti-Roubo*! Total de escudos: *' + user.shields + '*');
            }
            if (item.tipo === 'title') {
                if (user.title === item.titulo) return responder('⚠️ Voce ja possui este titulo VIP!');
                user.gold -= item.preco;
                user.title = item.titulo;
                salvarDB(db);
                return responder('👑 Parabens! Agora seu nome exibe *[' + item.titulo + ']* no Ranking!');
            }
        }

        // ==========================================
        // COMANDOS DOS DONOS (+ RESETGOLD)
        // ==========================================
        if (cmd === 'setmenu' || cmd === 'fotomenu') {
            if (!isOwner) return responder('🔒 Apenas os donos podem trocar a foto da Hinata do menu.');
            const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const targetMsg = quoted ? { message: quoted } : m;
            const targetType = quoted ? Object.keys(quoted)[0] : tipoMsg;

            if (targetType !== 'imageMessage') {
                return responder('⚠️ Envie uma foto da Hinata com a legenda *' + p + 'setmenu* ou responda a uma foto com *' + p + 'setmenu*!');
            }
            try {
                const buf = await downloadMediaMessage(targetMsg, 'buffer', {});
                fs.writeFileSync(menuImgPath, buf);
                return responder('🌸 Foto do menu atualizada com sucesso! Digite *' + p + 'menu* para testar.');
            } catch (e) {
                return responder('❌ Erro ao salvar a foto do menu.');
            }
        }

        if (cmd === 'donos' || cmd === 'listadonos') {
            let txt = '👑 *DONOS OFICIAIS DA HINATA BOT:* 👑\n\n';
            const mentions = [];
            db.owners.forEach((num, idx) => {
                const jid = num + '@s.whatsapp.net';
                const principal = mesmoUsuario(num, botNum) ? ' _(Principal)_' : '';
                txt += '*[ ' + (idx + 1) + ' ]* 👑 @' + num + ' (`' + num + '`)' + principal + '\n';
                mentions.push(jid);
            });
            txt += '\n➕ Para adicionar: *' + p + 'adddono <numero ou @>*';
            txt += '\n🗑️ Para remover pelo numero: *' + p + 'deldono 2* (ou digite o telefone)';
            return responder(txt, mentions);
        }

        if (cmd === 'adddono') {
            if (!isOwner) return responder('🔒 Apenas um dono pode adicionar outro dono.');
            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const resp = m.message.extendedTextMessage?.contextInfo?.participant;
            const textoNumeros = args.join('').replace(/\D/g, '');
            const alvo = limparNum(menc[0] || resp) || textoNumeros;

            if (!alvo || alvo.length < 8) {
                return responder('⚠️ Digite o numero com DDD ou marque a pessoa.\nExemplo: *' + p + 'adddono 556899999999* ou *' + p + 'adddono @pessoa*');
            }
            if (!db.owners.includes(alvo)) {
                db.owners.push(alvo);
                salvarDB(db);
            }
            const alvoJid = alvo + '@s.whatsapp.net';
            return responder('👑 @' + alvo + ' foi adicionado como *Dono*!\nDigite *' + p + 'donos* para ver a lista numerada.', [alvoJid]);
        }

        if (cmd === 'deldono' || cmd === 'remdono') {
            if (!isOwner) return responder('🔒 Apenas um dono pode remover outro dono.');
            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const resp = m.message.extendedTextMessage?.contextInfo?.participant;
            const entrada = (args[0] || '').trim();

            let alvo = '';

            if (!menc[0] && !resp && /^\d+$/.test(entrada) && parseInt(entrada) >= 1 && parseInt(entrada) <= db.owners.length && entrada.length <= 2) {
                const idx = parseInt(entrada) - 1;
                alvo = db.owners[idx];
            } else {
                const textoNumeros = args.join('').replace(/\D/g, '');
                alvo = limparNum(menc[0] || resp) || textoNumeros;
            }

            if (!alvo) {
                return responder('⚠️ Digite a posicao da lista (Ex: *' + p + 'deldono 2*) ou o numero de telefone.\nVeja as posicoes digitando *' + p + 'donos*');
            }
            if (mesmoUsuario(alvo, botNum)) {
                return responder('⚠️ Voce nao pode remover o numero principal do aparelho conectado ao bot!');
            }
            if (!db.owners.includes(alvo)) {
                return responder('⚠️ Esse numero nao esta na lista de donos! Digite *' + p + 'donos* para conferir.');
            }

            db.owners = db.owners.filter(n => n !== alvo);
            salvarDB(db);
            return responder('🗑️ O dono @' + alvo + ' (`' + alvo + '`) foi removido com sucesso!', [alvo + '@s.whatsapp.net']);
        }

        if (cmd === 'prefixo' || cmd === 'prefix') {
            if (!isOwner) return responder('🔒 Apenas os donos podem trocar o prefixo.');
            const novo = args[0];
            if (!novo || novo.length > 2) return responder('⚠️ Exemplo: *' + p + 'prefixo ,*');
            db.prefix = novo;
            salvarDB(db);
            return responder('👑 Prefixo alterado para: *' + novo + '*');
        }

        if (cmd === 'resetgold' || cmd === 'zerargold') {
            if (!isOwner) return responder('🔒 Apenas os donos podem resetar o Gold.');
            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const resp = m.message.extendedTextMessage?.contextInfo?.participant;
            const alvoJid = menc[0] || resp;

            if (alvoJid) {
                const alvoUser = obterUser(db, alvoJid);
                alvoUser.gold = 100;
                salvarDB(db);
                return responder('👑🔄 O saldo de @' + limparNum(alvoJid) + ' foi resetado para *100 Gold*!', [alvoJid]);
            }

            let totalResetados = 0;
            Object.keys(db.users).forEach(jid => {
                db.users[jid].gold = 100;
                db.users[jid].pickaxe = 1;
                db.users[jid].shields = 0;
                totalResetados++;
            });
            salvarDB(db);
            return responder('👑☢️ *RESET GERAL DA ECONOMIA!* ☢️👑\n\nO saldo de todos os *' + totalResetados + ' jogadores* foi resetado para *100 Gold* iniciais (os Pets foram mantidos)!');
        }

        if (cmd === 'addgold' || cmd === 'remgold') {
            if (!isOwner) return responder('🔒 Apenas os donos podem alterar o Gold.');
            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const resp = m.message.extendedTextMessage?.contextInfo?.participant;
            const alvoJid = menc[0] || resp || sender;
            const valStr = args.find(a => !a.startsWith('@') && !isNaN(Number(a)));
            const val = Number(valStr);

            if (!val || val <= 0) return responder('⚠️ Exemplo: *' + p + cmd + ' @pessoa 1000*');

            const alvoUser = obterUser(db, alvoJid);
            if (cmd === 'addgold') {
                alvoUser.gold += val;
                salvarDB(db);
                return responder('👑 *+' + val.toLocaleString('pt-BR') + ' Gold* para @' + limparNum(alvoJid) + '\nSaldo: *' + alvoUser.gold.toLocaleString('pt-BR') + '*', [alvoJid]);
            } else {
                alvoUser.gold = Math.max(0, alvoUser.gold - val);
                salvarDB(db);
                return responder('👑 *-' + val.toLocaleString('pt-BR') + ' Gold* de @' + limparNum(alvoJid) + '\nSaldo: *' + alvoUser.gold.toLocaleString('pt-BR') + '*', [alvoJid]);
            }
        }

        // ==========================================
        // ☢️ BOMBA ATOMICA (,bomba / ,bombaatomica)
        // ==========================================
        if (cmd === 'bomba' || cmd === 'bombaatomica' || cmd === 'nuke') {
            const CUSTO_BOMBA = 1000000;
            if (user.gold < CUSTO_BOMBA) {
                return responder(
                    `☢️ *BOMBA ATÔMICA* ☢️\n\n` +
                    `💸 Você precisa de *1.000.000 (1 Milhão) de Gold* para comprar e lançar uma Bomba Atômica!\n` +
                    `💰 Seu saldo atual: *${user.gold.toLocaleString('pt-BR')} Gold*`
                );
            }

            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const resp = m.message.extendedTextMessage?.contextInfo?.participant;
            const alvoJid = menc[0] || resp;

            if (!alvoJid) {
                return responder(`☢️ Marque ou responda a mensagem de quem você quer tentar ZERAR!\nExemplo: *${p}bomba @usuario*\n_(Custo: 1.000.000 Gold | Chance de acerto: 5%)_`);
            }
            if (alvoJid === sender) {
                return responder('🤦 Você não pode jogar uma Bomba Atômica em si mesmo!');
            }

            const vitima = obterUser(db, alvoJid);
            if (vitima.gold <= 0) {
                return responder(`💸 @${limparNum(alvoJid)} já está com *0 Gold*! Não vale a pena gastar 1 Milhão nele(a).`, [alvoJid]);
            }

            user.gold -= CUSTO_BOMBA;
            const acertou = Math.random() < 0.05;

            if (acertou) {
                const goldDestruido = vitima.gold;
                vitima.gold = 0;
                salvarDB(db);

                return responder([
                    '☢️💥 *IMPACTO NUCLEAR CONFIRMADO (5%)!* 💥☢️',
                    '',
                    `🚀 @${senderNum} pagou *1.000.000 Gold* e lançou uma *BOMBA ATÔMICA* direto no cofre de @${limparNum(alvoJid)}!`,
                    `🔥 *${goldDestruido.toLocaleString('pt-BR')} Gold* viraram cinzas instantaneamente!`,
                    `💀 Novo saldo de @${limparNum(alvoJid)}: *0 Gold*!`
                ].join('\n'), [sender, alvoJid]);
            } else {
                salvarDB(db);
                return responder([
                    '☢️💨 *A BOMBA ATÔMICA FALHOU (95%)!* 💨☢️',
                    '',
                    `🚀 @${senderNum} gastou *1.000.000 Gold* para lançar uma Bomba Atômica em @${limparNum(alvoJid)}, mas o míssil caiu no mar e não explodiu!`,
                    `💸 Você perdeu *1.000.000 Gold*!`,
                    `🏦 Seu saldo restante: *${user.gold.toLocaleString('pt-BR')} Gold*`
                ].join('\n'), [sender, alvoJid]);
            }
        }

        // ==========================================
        // GOLD, MINERAR, ROUBAR, VINGANCA, APOSTAR E TIGRINHO
        // ==========================================
        if (cmd === 'gold' || cmd === 'rank') {
            const lista = Object.entries(db.users)
                .sort((a, b) => b[1].gold - a[1].gold)
                .slice(0, 10);

            let txt = '🏆 *RANKING DE GOLD*\n';
            txt += '💰 Seu saldo: *' + user.gold.toLocaleString('pt-BR') + ' Gold* | ⛏️ Picareta: *' + user.pickaxe + 'x* | 🛡️ Escudos: *' + user.shields + '*\n\n';
            const mentions = [];
            lista.forEach(([jid, d], i) => {
                const pos = (i + 1) + 'º';
                const num = limparNum(jid);
                const tag = d.title ? ' [' + d.title + ']' : '';
                const petAtivo = d.pets && d.pets[d.activePet || 0] ? ` ${d.pets[d.activePet || 0].emoji}` : '';
                txt += pos + ' @' + num + tag + petAtivo + ' — *' + d.gold.toLocaleString('pt-BR') + ' Gold*\n';
                mentions.push(jid);
            });
            return responder(txt, mentions);
        }

        if (cmd === 'minerar' || cmd === 'mine') {
            const agora = Date.now();
            const rest = (1 * 60 * 1000) - (agora - user.lastMine);
            if (rest > 0) {
                const seg = Math.ceil(rest / 1000);
                return responder('⏳ Aguarde *' + seg + 's* para minerar novamente.');
            }
            const base = Math.floor(Math.random() * 151) + 50;
            const mult = user.pickaxe || 1;
            const pet = pegarPetAtivo(user);
            const bonusPet = (pet && pet.felicidade >= 60) ? Math.floor(base * 0.25 * pet.poder) : 0;
            const ganho = (base * mult) + bonusPet;

            user.gold += ganho;
            user.lastMine = agora;
            salvarDB(db);
            const txtBonusPet = bonusPet > 0 ? ` (+${bonusPet} bônus do seu ${pet.emoji} ${pet.nome})` : '';
            return responder('⛏️ Voce minerou *+' + ganho + ' Gold* (Picareta ' + mult + 'x)' + txtBonusPet + '!\n💰 Saldo: *' + user.gold.toLocaleString('pt-BR') + ' Gold*');
        }

        if (cmd === 'roubar' || cmd === 'rob') {
            const agora = Date.now();
            const rest = (3 * 60 * 1000) - (agora - user.lastRob);
            if (rest > 0) {
                const min = Math.floor(rest / 60000);
                const seg = Math.floor((rest % 60000) / 1000);
                return responder('🚓 Aguarde *' + min + 'm ' + seg + 's* para roubar de novo.');
            }

            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const resp = m.message.extendedTextMessage?.contextInfo?.participant;
            let alvoJid = menc[0] || resp;

            if (!alvoJid) {
                const alvos = Object.keys(db.users).filter(id => id !== sender && db.users[id].gold >= 20);
                if (alvos.length === 0) return responder('⚠️ Ninguem com Gold suficiente para roubo aleatorio. Marque alguem!');
                alvoJid = alvos[Math.floor(Math.random() * alvos.length)];
            }

            if (alvoJid === sender) return responder('🤦 Voce nao pode roubar a si mesmo!');

            const vitima = obterUser(db, alvoJid);
            if (vitima.gold < 20) return responder('💸 @' + limparNum(alvoJid) + ' tem menos de 20 Gold!', [alvoJid]);

            user.lastRob = agora;

            if (vitima.shields && vitima.shields > 0) {
                vitima.shields -= 1;
                salvarDB(db);
                return responder('🛡️ *ROUBO BLOQUEADO!* @' + limparNum(alvoJid) + ' tinha um Escudo Anti-Roubo! (Escudos restantes: ' + vitima.shields + ')', [alvoJid]);
            }

            if (Math.random() < 0.55) {
                const roubado = Math.max(10, Math.floor(vitima.gold * 0.25));
                vitima.gold -= roubado;
                vitima.stolenBy = sender;
                user.gold += roubado;
                salvarDB(db);
                return responder('🥷 Voce roubou *' + roubado.toLocaleString('pt-BR') + ' Gold* de @' + limparNum(alvoJid) + '!\n_(A vitima pode usar ' + p + 'vinganca para revidar!)_\n💰 Seu saldo: *' + user.gold.toLocaleString('pt-BR') + '*', [alvoJid]);
            } else {
                const multa = Math.min(user.gold, 50);
                user.gold -= multa;
                vitima.gold += multa;
                salvarDB(db);
                return responder('🚨 Foi pego ao tentar roubar @' + limparNum(alvoJid) + ' e pagou *' + multa + ' Gold*!\n💰 Saldo: *' + user.gold.toLocaleString('pt-BR') + '*', [alvoJid]);
            }
        }

        if (cmd === 'vinganca' || cmd === 'vingar') {
            if (!user.stolenBy) {
                return responder('🕊️ Ninguem roubou voce recentemente! Voce nao tem de quem se vingar no momento.');
            }
            const ladraoJid = user.stolenBy;
            const ladrao = obterUser(db, ladraoJid);
            user.stolenBy = null;

            if (ladrao.gold < 10) {
                salvarDB(db);
                return responder('💸 Seu ladrao (@' + limparNum(ladraoJid) + ') ja gastou tudo e esta falido!', [ladraoJid]);
            }

            if (Math.random() < 0.70) {
                const recuperado = Math.max(15, Math.floor(ladrao.gold * 0.40));
                ladrao.gold -= recuperado;
                user.gold += recuperado;
                salvarDB(db);
                return responder('⚔️ *VINGANCA IMPLACAVEL!*\nVoce invadiu o esconderijo de @' + limparNum(ladraoJid) + ' e tomou *' + recuperado.toLocaleString('pt-BR') + ' Gold* de volta!\n💰 Novo saldo: *' + user.gold.toLocaleString('pt-BR') + ' Gold*', [ladraoJid]);
            } else {
                const perda = Math.min(user.gold, 30);
                user.gold -= perda;
                ladrao.gold += perda;
                salvarDB(db);
                return responder('💥 *VINGANCA FALHOU!* @' + limparNum(ladraoJid) + ' estava preparado e voce perdeu mais *' + perda + ' Gold*!', [ladraoJid]);
            }
        }

        if (cmd === 'tigrinho' || cmd === 'tigre' || cmd === 'tiger') {
            let quantia = args[0]?.toLowerCase() === 'tudo' ? Math.min(user.gold, LIMITE_APOSTA) : Number(args[0]);
            if (!quantia || isNaN(quantia) || quantia < 10) {
                return responder('🐯 *FORTUNE TIGER DA HINATA* 🐯\nEscolha um valor de 10 ate 10.000.000 Gold!\nExemplo: *' + p + 'tigrinho 100*');
            }
            if (quantia > LIMITE_APOSTA) {
                return responder('⚠️ O limite maximo de aposta por giro e de *' + LIMITE_APOSTA.toLocaleString('pt-BR') + ' Gold*!');
            }
            if (user.gold < quantia) {
                return responder('💸 Saldo insuficiente! Voce tem *' + user.gold.toLocaleString('pt-BR') + ' Gold*.');
            }

            const simbolos = [
                { emoji: '🍊', nome: 'Laranja', mult: 1.5 },
                { emoji: '🧧', nome: 'Envelope', mult: 2 },
                { emoji: '💰', nome: 'Saco de Ouro', mult: 4 },
                { emoji: '💎', nome: 'Diamante', mult: 8 },
                { emoji: '🐯', nome: 'Tigre WILD', mult: 15 }
            ];

            const linhasPagamento = [
                { nome: 'Linha 1 (Topo)', pos: [0, 1, 2] },
                { nome: 'Linha 2 (Meio)', pos: [3, 4, 5] },
                { nome: 'Linha 3 (Base)', pos: [6, 7, 8] },
                { nome: 'Diagonal ↘️', pos: [0, 4, 8] },
                { nome: 'Diagonal ↗️', pos: [6, 4, 2] }
            ];

            function sortearSimbolo() {
                const r = Math.random();
                if (r < 0.38) return simbolos[0];
                if (r < 0.68) return simbolos[1];
                if (r < 0.86) return simbolos[2];
                if (r < 0.95) return simbolos[3];
                return simbolos[4];
            }

            function avaliarGrade(g) {
                let mTotal = 0;
                let det = [];
                for (const linha of linhasPagamento) {
                    const trio = [g[linha.pos[0]], g[linha.pos[1]], g[linha.pos[2]]];
                    const naoWild = trio.filter(s => s.emoji !== '🐯');
                    let fechou = false;
                    let simVencedor = null;

                    if (naoWild.length === 0) {
                        fechou = true;
                        simVencedor = simbolos[4];
                    } else {
                        const prim = naoWild[0].emoji;
                        if (naoWild.every(s => s.emoji === prim)) {
                            fechou = true;
                            simVencedor = naoWild[0];
                        }
                    }
                    if (fechou && simVencedor) {
                        mTotal += simVencedor.mult;
                        det.push('✅ ' + linha.nome + ': ' + simVencedor.emoji + ' (*' + simVencedor.mult + 'x*)');
                    }
                }
                return { multTotal: mTotal, detalhesGanhos: det };
            }

            const vaiGanhar = Math.random() < 0.25;
            let grade = [];
            let soltouCarta = false;
            let resultado = { multTotal: 0, detalhesGanhos: [] };

            if (vaiGanhar) {
                if (Math.random() < 0.10) {
                    soltouCarta = true;
                    const escolhido = simbolos[Math.floor(Math.random() * 4)];
                    for (let i = 0; i < 9; i++) {
                        grade.push(Math.random() < 0.85 ? escolhido : simbolos[4]);
                    }
                    resultado = avaliarGrade(grade);
                } else {
                    do {
                        grade = [];
                        for (let i = 0; i < 9; i++) grade.push(sortearSimbolo());
                        resultado = avaliarGrade(grade);
                    } while (resultado.multTotal === 0);
                }
            } else {
                do {
                    grade = [];
                    for (let i = 0; i < 9; i++) grade.push(sortearSimbolo());
                    resultado = avaliarGrade(grade);
                } while (resultado.multTotal > 0);
            }

            let { multTotal, detalhesGanhos } = resultado;
            let telaCheia10x = false;
            if (detalhesGanhos.length === 5) {
                telaCheia10x = true;
                multTotal = multTotal * 10;
            }

            const telaTxt = [
                '🐯 *FORTUNE TIGER - HINATA* 🐯',
                soltouCarta ? '✨🧧 *O TIGRINHO SOLTOU A CARTINHA!* 🧧✨' : '',
                '╔═══════════╗',
                '║  ' + grade[0].emoji + '  │  ' + grade[1].emoji + '  │  ' + grade[2].emoji + '  ║',
                '╟───────────╢',
                '║  ' + grade[3].emoji + '  │  ' + grade[4].emoji + '  │  ' + grade[5].emoji + '  ║',
                '╟───────────╢',
                '║  ' + grade[6].emoji + '  │  ' + grade[7].emoji + '  │  ' + grade[8].emoji + '  ║',
                '╚═══════════╝'
            ].filter(Boolean).join('\n');

            if (multTotal > 0) {
                const ganhoBruto = Math.floor(quantia * multTotal);
                user.gold += ganhoBruto;
                salvarDB(db);

                const msgVitoria = [
                    telaTxt,
                    '',
                    telaCheia10x ? '🔥🎉 *MEGA GANHO TELA CHEIA (BONUS 10X ATIVADO)!* 🎉🔥' : '🎉 *O TIGRINHO PAGOU!* 🎉',
                    ...detalhesGanhos,
                    '',
                    '💰 Multiplicador Total: *' + multTotal + 'x*',
                    '🤑 Voce ganhou: *+' + ganhoBruto.toLocaleString('pt-BR') + ' Gold*!',
                    '🏦 Novo saldo: *' + user.gold.toLocaleString('pt-BR') + ' Gold*'
                ].join('\n');

                return responder(msgVitoria);
            } else {
                user.gold -= quantia;
                salvarDB(db);

                const msgDerrota = [
                    telaTxt,
                    '',
                    '💀 *O TIGRINHO NAO PAGOU DESSA VEZ!*',
                    '💸 Voce perdeu: *-' + quantia.toLocaleString('pt-BR') + ' Gold*',
                    '🏦 Saldo atual: *' + user.gold.toLocaleString('pt-BR') + ' Gold*'
                ].join('\n');

                return responder(msgDerrota);
            }
        }

        if (cmd === 'apostar' || cmd === 'bet' || cmd === 'cassino') {
            let quantia = args[0]?.toLowerCase() === 'tudo' ? Math.min(user.gold, LIMITE_APOSTA) : Number(args[0]);
            if (!quantia || isNaN(quantia) || quantia < 10) {
                return responder('🎰 Escolha um valor de 10 ate 10.000.000 Gold para apostar!\nExemplo: *' + p + 'apostar 100*');
            }
            if (quantia > LIMITE_APOSTA) {
                return responder('⚠️ O limite maximo de aposta por vez e de *' + LIMITE_APOSTA.toLocaleString('pt-BR') + ' Gold*!');
            }
            if (user.gold < quantia) {
                return responder('💸 Voce nao tem esse Gold todo! Seu saldo atual e de *' + user.gold.toLocaleString('pt-BR') + ' Gold*.');
            }

            const itensSlot = ['🍒', '🍋', '🍇', '💎', '7️⃣'];
            const vaiGanhar = Math.random() < 0.20;
            let s1, s2, s3;

            if (vaiGanhar) {
                if (Math.random() < 0.15) {
                    s1 = itensSlot[Math.floor(Math.random() * itensSlot.length)];
                    s2 = s1;
                    s3 = s1;
                } else {
                    s1 = itensSlot[Math.floor(Math.random() * itensSlot.length)];
                    s2 = s1;
                    do {
                        s3 = itensSlot[Math.floor(Math.random() * itensSlot.length)];
                    } while (s3 === s1);
                }
            } else {
                s1 = itensSlot[Math.floor(Math.random() * itensSlot.length)];
                do {
                    s2 = itensSlot[Math.floor(Math.random() * itensSlot.length)];
                } while (s2 === s1);
                do {
                    s3 = itensSlot[Math.floor(Math.random() * itensSlot.length)];
                } while (s3 === s1 || s3 === s2);
            }

            const visor = '🎰 *[ ' + s1 + ' | ' + s2 + ' | ' + s3 + ' ]* 🎰\n\n';

            if (s1 === s2 && s2 === s3) {
                const premio = quantia * 4;
                user.gold += premio;
                salvarDB(db);
                return responder(visor + '🔥 *JACKPOT TRIPLO (4x)!*\nVoce ganhou *+' + premio.toLocaleString('pt-BR') + ' Gold*!\n💰 Saldo: *' + user.gold.toLocaleString('pt-BR') + ' Gold*');
            } else if (s1 === s2 || s2 === s3 || s1 === s3) {
                user.gold += quantia;
                salvarDB(db);
                return responder(visor + '✨ *PAR VENCEDOR (2x)!*\nVoce lucrou *+' + quantia.toLocaleString('pt-BR') + ' Gold*!\n💰 Saldo: *' + user.gold.toLocaleString('pt-BR') + ' Gold*');
            } else {
                user.gold -= quantia;
                salvarDB(db);
                return responder(visor + '💀 *NAO FOI DESSA VEZ!*\nVoce perdeu *-' + quantia.toLocaleString('pt-BR') + ' Gold*.\n💰 Saldo: *' + user.gold.toLocaleString('pt-BR') + ' Gold*');
            }
        }

        // ==========================================
        // JOGO DA VELHA (,velha e ,jogar)
        // ==========================================
        if (cmd === 'velha' || cmd === 'ttt') {
            if (args[0] === 'sair' || args[0] === 'fim') {
                delete jogosVelha[from];
                return responder('🏳️ Partida de Jogo da Velha encerrada.');
            }
            if (jogosVelha[from]) {
                return responder('⚠️ Ja existe um Jogo da Velha rolando neste chat! Use *' + p + 'jogar <1-9>* ou digite *' + p + 'velha sair* para cancelar.');
            }

            const menc = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const oponente = menc[0] || 'BOT';

            if (oponente === sender) return responder('🤦 Voce nao pode jogar contra si mesmo! Digite apenas *' + p + 'velha* para jogar contra a Hinata Bot.');

            jogosVelha[from] = {
                board: ['1','2','3','4','5','6','7','8','9'],
                pX: sender,
                pO: oponente,
                turn: sender
            };

            const descOponente = oponente === 'BOT' ? '🌸 *Hinata Bot* (Premio: 150 Gold)' : '@' + limparNum(oponente) + ' (Premio: 200 Gold)';
            const msgVelha = [
                '🎮 *JOGO DA VELHA INICIADO!*',
                '❌ Jogador X: @' + senderNum,
                '⭕ Jogador O: ' + descOponente,
                '',
                renderTabuleiro(jogosVelha[from].board),
                '',
                '👉 Vez de @' + senderNum + ': Digite *' + p + 'jogar <1 a 9>*'
            ].join('\n');

            const mencoes = oponente === 'BOT' ? [sender] : [sender, oponente];
            return responder(msgVelha, mencoes);
        }

        if (cmd === 'jogar') {
            const g = jogosVelha[from];
            if (!g) return responder('⚠️ Nenhum Jogo da Velha ativo! Inicie com *' + p + 'velha* ou *' + p + 'velha @amigo*');
            if (sender !== g.turn) return responder('⏳ Calma! Agora e a vez de @' + limparNum(g.turn), [g.turn]);

            const pos = parseInt(args[0]) - 1;
            if (isNaN(pos) || pos < 0 || pos > 8 || g.board[pos] === 'X' || g.board[pos] === 'O') {
                return responder('⚠️ Posicao invalida ou ja ocupada! Escolha um numero livre de 1 a 9.');
            }

            const simbolo = sender === g.pX ? 'X' : 'O';
            g.board[pos] = simbolo;

            let resultado = checarVencedorVelha(g.board);
            if (resultado) {
                delete jogosVelha[from];
                if (resultado === 'EMPATE') {
                    return responder('🤝 *DEU VELHA (EMPATE)!*\n\n' + renderTabuleiro(g.board));
                }
                const premio = g.pO === 'BOT' ? 150 : 200;
                user.gold += premio;
                salvarDB(db);
                return responder('🏆 *VITORIA DE @' + senderNum + '!*\nGanhou *+' + premio + ' Gold*!\n\n' + renderTabuleiro(g.board), [sender]);
            }

            if (g.pO === 'BOT') {
                const livres = g.board.map((v, i) => (v !== 'X' && v !== 'O' ? i : null)).filter(v => v !== null);
                const escolhaBot = livres[Math.floor(Math.random() * livres.length)];
                g.board[escolhaBot] = 'O';

                resultado = checarVencedorVelha(g.board);
                if (resultado) {
                    delete jogosVelha[from];
                    if (resultado === 'EMPATE') {
                        return responder('🤝 *DEU VELHA (EMPATE)!*\n\n' + renderTabuleiro(g.board));
                    }
                    return responder('🌸 *A HINATA BOT VENCEU!* Mais sorte na proxima!\n\n' + renderTabuleiro(g.board));
                }
                return responder('🌸 A Hinata jogou na casa ' + (escolhaBot + 1) + '!\n\n' + renderTabuleiro(g.board) + '\n\n👉 Sua vez (@' + senderNum + '): *' + p + 'jogar <1-9>*', [sender]);
            } else {
                g.turn = sender === g.pX ? g.pO : g.pX;
                return responder(renderTabuleiro(g.board) + '\n\n👉 Vez de @' + limparNum(g.turn) + ': Digite *' + p + 'jogar <1-9>*', [g.turn]);
            }
        }

        // ==========================================
        // PACK DE FIGURINHAS (,addfig e ,fig)
        // ==========================================
        if (cmd === 'addfig') {
            const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted || !quoted.stickerMessage) {
                return responder('⚠️ Responda a uma figurinha com *' + p + 'addfig* para adiciona-la ao pack do bot!');
            }
            try {
                const buf = await downloadMediaMessage({ message: quoted }, 'buffer', {});
                const nomeArq = path.join(packDir, 'fig_' + Date.now() + '.webp');
                fs.writeFileSync(nomeArq, buf);
                const total = fs.readdirSync(packDir).filter(f => f.endsWith('.webp')).length;
                return responder('✅ Figurinha salva no pack! Total no pacote: *' + total + ' figurinhas*.\nPara receber, use *' + p + 'fig 5*');
            } catch (e) {
                return responder('❌ Erro ao salvar a figurinha no pack.');
            }
        }

        if (cmd === 'fig' || cmd === 'pack') {
            const arquivos = fs.readdirSync(packDir).filter(f => f.endsWith('.webp'));
            if (arquivos.length === 0) {
                return responder('📦 O pack de figurinhas ainda esta vazio!\nResponda a qualquer figurinha do chat com *' + p + 'addfig* para abastecer o pack.');
            }

            let qtd = parseInt(args[0]) || 1;
            if (qtd < 1) qtd = 1;
            if (qtd > 10) qtd = 10;

            await responder('📦 Enviando *' + qtd + '* figurinha(s) do pack...');
            for (let i = 0; i < qtd; i++) {
                const sorteada = arquivos[Math.floor(Math.random() * arquivos.length)];
                const figBuf = fs.readFileSync(path.join(packDir, sorteada));
                await sock.sendMessage(from, { sticker: figBuf });
            }
            return;
        }

// ==========================================
        // CRIAR FIGURINHA NATIVA COM SOM (,ssom) COM RASTREAMENTO DE LINHA
        // ==========================================
        if (cmd === 'ssom' || cmd === 'stickersom' || cmd === 'figsom') {
            const relatarErro = async (etapa, err) => {
                delete downloadsPendentes['ssom_' + sender];
                const stackLines = (err?.stack || '').split('\n');
                const linhaIndex = stackLines.find(l => l.includes('index.js')) || stackLines[1] || 'Linha desconhecida';
                const matchLinha = linhaIndex.match(/index\.js:(\d+):(\d+)/);
                const numLinha = matchLinha ? `Linha ${matchLinha[1]} (coluna ${matchLinha[2]})` : linhaIndex.trim();

                const msgTerminal = `\n❌ [ERRO NO COMANDO ,ssom - ${etapa}]\n📍 Local: ${numLinha}\n💬 Motivo: ${err?.message || err}\n`;
                console.error(msgTerminal);

                await responder(
                    `❌ *ERRO NO COMANDO ,ssom*\n` +
                    `📌 *Etapa:* ${etapa}\n` +
                    `📍 *Local:* ${numLinha}\n` +
                    `💬 *Detalhes:* ${err?.message || err}`
                );
            };

            const ctx = m.message.extendedTextMessage?.contextInfo;
            const quoted = ctx?.quotedMessage;
            const targetMsg = quoted
                ? {
                    key: {
                        remoteJid: from,
                        fromMe: false,
                        id: ctx.stanzaId,
                        participant: ctx.participant
                    },
                    message: quoted
                }
                : m;
            const targetType = quoted ? Object.keys(quoted)[0] : tipoMsg;

            if (targetType !== 'videoMessage') {
                return responder('⚠️ Envie um *vídeo* com *' + p + 'ssom* na legenda (ou responda a um vídeo)!');
            }

            if (downloadsPendentes['ssom_' + sender]) {
                return responder('⏳ Já estou processando uma figurinha sua, aguarde...');
            }
            downloadsPendentes['ssom_' + sender] = true;

            await responder('⏳ Criando figurinha nativa com som...');

            try {
                console.log('[SSOM - ETAPA 1/5] Baixando vídeo do WhatsApp...');
                const downloadComTimeout = Promise.race([
                    downloadMediaMessage(
                        targetMsg,
                        'buffer',
                        {},
                        {
                            logger: pino({ level: 'silent' }),
                            reuploadRequest: sock.updateMediaMessage
                        }
                    ),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Tempo esgotado (15s) ao baixar vídeo do WhatsApp')), 15000)
                    )
                ]);

                const buf = await downloadComTimeout;
                console.log(`[SSOM - ETAPA 2/5] Vídeo baixado (${buf.length} bytes). Salvando temporário...`);

                const ts = Date.now();
                const inP = path.join(__dirname, 'in_som_' + ts + '.mp4');
                const outMp4 = path.join(__dirname, 'out_som_' + ts + '.mp4');
                fs.writeFileSync(inP, buf);

                console.log('[SSOM - ETAPA 3/5] Convertendo vídeo e áudio no FFmpeg...');
                const filtro = 'scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=black';
                const cmdSom = `ffmpeg -y -i "${inP}" -t 7 -vf "${filtro},fps=15" -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart "${outMp4}"`;

                exec(cmdSom, { timeout: 25000 }, async (err, stdout, stderr) => {
                    if (fs.existsSync(inP)) fs.unlinkSync(inP);

                    if (err || !fs.existsSync(outMp4)) {
                        if (fs.existsSync(outMp4)) fs.unlinkSync(outMp4);
                        return relatarErro('ETAPA 3/5 (Conversão FFmpeg)', new Error(err?.message || stderr || 'Arquivo não gerado'));
                    }

                    console.log('[SSOM - ETAPA 4/5] Enviando sticker com som via whaileys...');
                    try {
                        await sock.sendMessage(from, {
                            sticker: fs.readFileSync(outMp4),
                            mimetype: 'video/mp4',
                            isAnimated: true
                        }, { quoted: m });

                        delete downloadsPendentes['ssom_' + sender];
                        console.log('[SSOM - ETAPA 5/5] Concluído e entregue com sucesso!');
                    } catch (eSend) {
                        await relatarErro('ETAPA 4/5 (Envio sock.sendMessage)', eSend);
                    } finally {
                        if (fs.existsSync(outMp4)) fs.unlinkSync(outMp4);
                    }
                });
            } catch (eGeral) {
                await relatarErro('ETAPA 1-2/5 (Download da Mídia)', eGeral);
            }
            return;
        }

        // ==========================================
        // CRIAR FIGURINHA NORMAL (,s) E DOWNLOAD INTERATIVO (,baixar, ,mp3, ,mp4)
        // ==========================================
        if (cmd === 's' || cmd === 'sticker') {
            const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const targetMsg = quoted ? { message: quoted } : m;
            const targetType = quoted ? Object.keys(quoted)[0] : tipoMsg;

            if (targetType === 'imageMessage' || targetType === 'videoMessage') {
                await responder('⏳ Criando figurinha...');
                try {
                    const buf = await downloadMediaMessage(targetMsg, 'buffer', {});
                    const ext = targetType === 'imageMessage' ? 'jpg' : 'mp4';
                    const inP = path.join(__dirname, 'in_' + Date.now() + '.' + ext);
                    const outP = path.join(__dirname, 'out_' + Date.now() + '.webp');
                    fs.writeFileSync(inP, buf);

                    const filtro = 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000';
                    const ffCmd = ext === 'jpg'
                        ? 'ffmpeg -i "' + inP + '" -vf "' + filtro + '" "' + outP + '"'
                        : 'ffmpeg -i "' + inP + '" -t 7 -vf "' + filtro + ',fps=15" -vcodec libwebp -lossless 0 -q:v 50 -loop 0 -an "' + outP + '"';

                    exec(ffCmd, async (err) => {
                        if (fs.existsSync(inP)) fs.unlinkSync(inP);
                        if (err || !fs.existsSync(outP)) return responder('❌ Erro ao converter.');
                        const stickerGerado = fs.readFileSync(outP);
                        await sock.sendMessage(from, { sticker: stickerGerado }, { quoted: m });
                        fs.copyFileSync(outP, path.join(packDir, 'fig_' + Date.now() + '.webp'));
                        fs.unlinkSync(outP);
                    });
                } catch (e) {
                    await responder('❌ Falha ao baixar midia.');
                }
            } else {
                await responder('⚠️ Envie ou responda uma foto/video com *' + p + 's*');
            }
        }

        if (cmd === 'mp3' || cmd === 'musica' || cmd === 'audio') {
            const url = args[0] || downloadsPendentes[chaveDownload]?.url;
            if (!url || !url.startsWith('http')) {
                return responder('⚠️ Envie o link junto! Exemplo: *' + p + 'mp3 https://...*');
            }
            delete downloadsPendentes[chaveDownload];
            return processarDownload(url, 'mp3');
        }

        if (cmd === 'mp4' || cmd === 'video') {
            const url = args[0] || downloadsPendentes[chaveDownload]?.url;
            if (!url || !url.startsWith('http')) {
                return responder('⚠️ Envie o link junto! Exemplo: *' + p + 'mp4 https://...*');
            }
            delete downloadsPendentes[chaveDownload];
            return processarDownload(url, 'mp4');
        }

        if (cmd === 'baixar' || cmd === 'dl') {
            const url = args[0];
            if (!url || !url.startsWith('http')) {
                return responder('⚠️ Envie o link junto com o comando!\nExemplo: *' + p + 'baixar https://...*');
            }

            downloadsPendentes[chaveDownload] = {
                url: url,
                time: Date.now()
            };

            const menuEscolha = [
                '📥 *ESCOLHA O FORMATO DO DOWNLOAD:*',
                '',
                '👉 Digite *1* para 🎬 *Vídeo (MP4)*',
                '👉 Digite *2* para 🎵 *Música / Áudio (MP3)*',
                '',
                '_(Basta enviar o número 1 ou 2 aqui no chat!)_'
            ].join('\n');

            return responder(menuEscolha);
        }
    });
}

iniciarBot();
