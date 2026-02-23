import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { MatrixClient } from '@vector-im/matrix-bot-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '.env') });

// Set HOME for Windows compatibility
if (!process.env.HOME && process.env.USERPROFILE) {
  process.env.HOME = process.env.USERPROFILE;
}

async function testMessage() {
  console.log('Testing message handling...');
  
  const client = new MatrixClient(
    process.env.MATRIX_HOMESERVER,
    process.env.MATRIX_ACCESS_TOKEN
  );
  
  // We need to get a room ID that the bot is in
  const rooms = await client.getJoinedRooms();
  console.log('Rooms:', rooms);
  
  if (rooms.length === 0) {
    console.log('Bot is not in any rooms. Please invite the bot to a room first.');
    return;
  }
  
  const roomId = rooms[0];
  console.log('Using room:', roomId);
  
  // Send a test message
  await client.sendMessage(roomId, {
    msgtype: 'm.text',
    body: 'Test message from plugin'
  });
  
  console.log('Test message sent. Check if the bot replies...');
  
  // Wait a bit for the bot to reply
  setTimeout(() => {
    console.log('Test completed.');
    process.exit(0);
  }, 5000);
}

testMessage().catch(console.error);