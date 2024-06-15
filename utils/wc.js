import { Core } from "@walletconnect/core";
import { SignClient } from "@walletconnect/sign-client";
import QRCode from "qrcode";
import dotenv from "dotenv";
dotenv.config();
import { bot } from "../index.js";

// Map to store connection IDs and their corresponding telegramIds
const connectionRequests = new Map();

// showWalletHolderModal to send uri and qr code
export async function showWalletHolderModal(user, uri) {
  const chatId = user;
  try {
    const qrCodeBuffer = await QRCode.toBuffer(uri);
    const sentMessage = await bot.sendPhoto(chatId, qrCodeBuffer, {
      caption: uri,
    });
    return sentMessage.message_id;
  } catch (error) {
    console.error("Wallet Holder modal error:", error);
  }
}

// Creates a map to store active client instances
const clients = new Map();

// Helper function to check if a client has an active pairing
async function hasActivePairing(client) {
  let allPairings = client.core.pairing.pairings.getAll({ active: true });
  return allPairings.length > 0;
}

// Helper function to resume a WalletConnect session, not likely needed without storage
async function resumeSession(user, client) {
  let allPairings = client.core.pairing.pairings.getAll({ active: true });
  const { uri } = await client.connect({
    pairingTopic: allPairings[0].topic,
    metadata,
    requiredNamespaces: requiredNamespaces,
  });
  if (uri) {
    await showWalletHolderModal(user, uri);
  }
}

export async function loadWalletConnectSession(user) {
  let telegramId = user;
  let client;

  if (clients.has(telegramId)) {
    client = clients.get(telegramId);
  } else {
    client = await initializeClient(telegramId);
    clients.set(telegramId, client);
  }

  if (!(await hasActivePairing(client))) {
    const sessionData = await createWalletConnectSession(user);
    return sessionData;
  } else if (client.session && client.session.status !== "connected") {
    // const resumedSessionData = await resumeSession(user, client);
    const resumedSessionData = await createWalletConnectSession(user);
    return resumedSessionData;
  }

  const session = client.session;
  const sessions = session.getAll({ acknowledged: true });
  const ses = sessions.find((s) => s.namespaces && s.namespaces.kadena);

  if (ses) {
    const sessionDetails = {
      client,
      user,
      session,
      account: "k:" + ses.namespaces.kadena.accounts[0].split(":")[2],
      pubKey: ses.namespaces.kadena.accounts[0].split(":").slice(2).join(":"),
      sessionTopic: ses.topic,
    };
    return sessionDetails;
  } else {
    const sessionData = await createWalletConnectSession(user);
    return sessionData;
  }
}

const requiredNamespaces = {
  kadena: {
    methods: ["kadena_getAccounts_v1", "kadena_sign_v1", "kadena_quicksign_v1"],
    // chains: ["kadena:testnet04"],
    chains: ["kadena:mainnet01"],
    events: [],
  },
};

const metadata = {
  name: "Bro Bot",
  description: "Sup Bro",
  url: "https://brostuffonkda.com",
  icons: ["https://main--kadenai.netlify.app/images/md.png"],
};

async function initializeClient(telegramId) {
  // Helper function to initialize a WalletConnect client
  const core = new Core({
    projectId: process.env.PROJECT_ID,
    relayUrl: "wss://relay.walletconnect.com",
  });

  const client = await SignClient.init({
    core,
    metadata,
    relayProvider: "wss://relay.walletconnect.org",
    // logger: "trace",
  });

  // Log all events for debugging
  // client.on("*", (event, data) => console.log(`Event: ${event}`, data));

  // Subscribe to events
  // client.on("session_update", (event) => handleSessionUpdate(telegramId));
  // client.on("session_delete", (event) => handleSessionUpdate(telegramId));
  return client;
}

async function handleSessionUpdate(user, { topic, params }) {
  const { namespaces } = params;
  const updatedSession = { ...client.session.get(topic), namespaces };

  await storeSessionData(user.username, topic, updatedSession);
}

export async function disconnectWC(user) {
  let telegramId = user;
  let client = clients.get(telegramId);

  if (clients.has(telegramId)) {
    client = clients.get(telegramId);
    let allPairings = client.core.pairing.pairings.getAll({ active: true });
    const pairingTopic = allPairings[0].topic;

    try {
      await client.disconnect({
        topic: pairingTopic,
        reason: "USER_DISCONNECTED",
      });
      client.session.delete(pairingTopic); // Clear the client session
      clients.delete(telegramId);
    } catch (error) {
      console.error("Error in disconnectWC:", error);
      throw error;
    }
  }
}

export async function createWalletConnectSession(user) {
  let telegramId = user;
  let client = clients.get(telegramId);

  if (!client) {
    client = await initializeClient(telegramId);
    clients.set(telegramId, client);
  }

  try {
    const { uri, approval } = await client.connect({
      metadata,
      requiredNamespaces: requiredNamespaces,
    });

    // Store the connection request with the telegramId and URI
    connectionRequests.set(telegramId, uri);

    // Send the QR code and URI to the user
    const qrMessageId = await showWalletHolderModal(telegramId, uri);

    const session = await approval();

    // Delete the connection request from the map
    connectionRequests.delete(telegramId);

    // Delete the QR code message
    await bot.deleteMessage(telegramId, qrMessageId);

    // Send confirmation message
    // await bot.sendMessage(telegramId, "You are now connected.");

    return { client, uri };
  } catch (error) {
    console.error("Error in createWalletConnectSession:", error);
    // Delete the connection request from the map in case of an error
    connectionRequests.delete(telegramId);
    throw error;
  }
}

export async function getActiveSessionDetails(user) {
  let telegramId = user;
  let client = clients.get(telegramId);

  if (client && client.session && client.session.map) {
    // Get the first active session from the map
    const sessions = Array.from(client.session.map.values());
    const activeSession = sessions.find((s) => s.acknowledged === true);

    if (
      activeSession &&
      activeSession.namespaces &&
      activeSession.namespaces.kadena
    ) {
      let account =
        "k:" + activeSession.namespaces.kadena.accounts[0].split(":")[2];
      return {
        isConnected: true,
        account: account,
        client: client,
        session: activeSession,
      };
    }
  }

  return { isConnected: false };
}
