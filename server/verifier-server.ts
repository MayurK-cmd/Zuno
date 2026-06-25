import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Barretenberg } from '@aztec/bb.js';

type Request = express.Request;
type Response = express.Response;

// __dirname equivalent in ES modules
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Load environment variables from root .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Load verification keys from circuits directory
let playCardVk: Buffer;
let drawCardVk: Buffer;
let bbInstance: Barretenberg | null = null;

// Load verification keys from circuits directory
const loadVKFiles = async () => {
  try {
    // Load real VK files from circuits directory
    const playCardVkPath = path.join(__dirname, '../circuits/play_card/target/vk/vk');
    const drawCardVkPath = path.join(__dirname, '../circuits/draw_card/target/vk/vk');

    const [playKey, drawKey] = await Promise.all([
      fs.readFile(playCardVkPath),
      fs.readFile(drawCardVkPath)
    ]);

    playCardVk = playKey;
    drawCardVk = drawKey;

    console.log(`Loaded VK files:`);
    console.log(`  Play card VK: ${playCardVk.length} bytes from ${playCardVkPath}`);
    console.log(`  Draw card VK: ${drawCardVk.length} bytes from ${drawCardVkPath}`);
  } catch (error) {
    console.error('Failed to load VK files:', error);
    process.exit(1);
  }
};

await loadVKFiles();

// Initialize bb.js instance
async function initializeBB(): Promise<Barretenberg> {
  if (!bbInstance) {
    bbInstance = await Barretenberg.new();
    console.log('Initialized bb.js instance');
  }
  return bbInstance;
}

// POST endpoint for verifying play card proofs
app.post('/api/verify-play-card', async (req: Request, res: Response) => {
  try {
    const { proof, publicInputs } = req.body;

    // Validate inputs exist
    if (!proof || !publicInputs) {
      return res.status(400).json({
        valid: false,
        error: 'Missing proof or publicInputs'
      });
    }

    // Convert proof string to Buffer if needed
    const proofBuffer = typeof proof === 'string'
      ? Buffer.from(proof.replace('0x', ''), 'hex')
      : Buffer.from(proof);

    // Convert publicInputs array to expected format
    const publicInputsArray = Array.isArray(publicInputs)
      ? publicInputs
      : [publicInputs];

    // Initialize bb.js and verify proof
    const bb = await initializeBB();
    const isValid = await bb.acirVerifyUltraHonk(proofBuffer, playCardVk);

    if (isValid) {
      // Sign the proof with server's private key
      const privateKey = process.env.VERIFIER_PRIVATE_KEY;
      if (!privateKey) {
        return res.status(500).json({
          valid: false,
          error: 'Verifier not configured'
        });
      }

      const signer = new ethers.Wallet(privateKey);
      const signature = await signer.signMessage(proofBuffer);

      res.json({
        valid: true,
        signature: signature
      });
    } else {
      res.json({
        valid: false,
        error: 'Proof verification failed'
      });
    }
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST endpoint for verifying draw card proofs
app.post('/api/verify-draw-card', async (req: Request, res: Response) => {
  try {
    const { proof, publicInputs } = req.body;

    // Validate inputs exist
    if (!proof || !publicInputs) {
      return res.status(400).json({
        valid: false,
        error: 'Missing proof or publicInputs'
      });
    }

    // Convert proof string to Buffer if needed
    const proofBuffer = typeof proof === 'string'
      ? Buffer.from(proof.replace('0x', ''), 'hex')
      : Buffer.from(proof);

    // Convert publicInputs array to expected format
    const publicInputsArray = Array.isArray(publicInputs)
      ? publicInputs
      : [publicInputs];

    // Initialize bb.js and verify proof
    const bb = await initializeBB();
    const isValid = await bb.acirVerifyUltraHonk(proofBuffer, drawCardVk);

    if (isValid) {
      // Sign the proof with server's private key
      const privateKey = process.env.VERIFIER_PRIVATE_KEY;
      if (!privateKey) {
        return res.status(500).json({
          valid: false,
          error: 'Verifier not configured'
        });
      }

      const signer = new ethers.Wallet(privateKey);
      const signature = await signer.signMessage(proofBuffer);

      res.json({
        valid: true,
        signature: signature
      });
    } else {
      res.json({
        valid: false,
        error: 'Proof verification failed'
      });
    }
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.listen(port, () => {
  console.log(`Verifier server running on port ${port}`);
});