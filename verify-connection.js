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

async function verifyConnection() {
  console.log('Verifying Matrix connection and listening capability...');
  
  const client = new MatrixClient(
    process.env.MATRIX_HOMESERVER,
    process.env.MATRIX_ACCESS_TOKEN
  );
  
  console.log('1. Testing basic connectivity...');
  
  try {
    // Get user ID to verify authentication
    console.log('Getting user ID...');
    const userId = await client.getUserId();
    console.log(`✅ Authenticated as: ${userId}`);
    
    // Get joined rooms
    console.log('Getting joined rooms...');
    const rooms = await client.getJoinedRooms();
    console.log(`✅ Joined ${rooms.length} room(s): ${rooms.join(', ')}`);
    
    // Test sending a message
    if (rooms.length > 0) {
      const roomId = rooms[0];
      console.log(`Testing message sending to room: ${roomId}`);
      
      await client.sendMessage(roomId, {
        msgtype: 'm.text',
        body: '[Matrix Plugin Test] Connection verified at ' + new Date().toLocaleString()
      });
      console.log('✅ Test message sent successfully');
    } else {
      console.log('⚠️  Bot is not in any rooms. Invite the bot to a room to receive messages.');
    }
    
    // Set up message listener
    console.log('Setting up message listener...');
    
    let messageReceived = false;
    let listenerRemoved = false;
    
    const messageHandler = async (roomId, event) => {
      if (event.type === 'm.room.message') {
        messageReceived = true;
        console.log(`📨 Message received in ${roomId}: ${event.content.body}`);
        console.log('✅ Plugin message listening is working!');
        
        // Remove listener to avoid infinite loop
        if (!listenerRemoved) {
          listenerRemoved = true;
          client.removeListener('room.message', messageHandler);
          console.log('Listener removed to prevent duplication');
        }
      }
    };
    
    client.on('room.message', messageHandler);
    
    console.log('Starting client sync...');
    await client.start();
    console.log('✅ Client started and listening for messages');
    
    console.log('\n=== Summary ===');
    console.log('Matrix connection: ✅ Active');
    console.log(`Authenticated as: ${userId}`);
    console.log(`Joined rooms: ${rooms.length}`);
    console.log('Message sending: ✅ Working');
    console.log('Message listening: ✅ Enabled');
    
    if (rooms.length === 0) {
      console.log('\n⚠️  IMPORTANT: The bot is not in any Matrix rooms.');
      console.log('To test message reception, invite the bot to a room:');
      console.log(`1. Invite @btc1000waibot:matrix.jp.chenhuangke.space to a room`);
      console.log('2. Send a message starting with !help or natural language');
    } else {
      console.log('\n📝 Test Instructions:');
      console.log('1. Go to Matrix client and send a message to the bot');
      console.log('2. Use commands: !help, !status, or natural language');
      console.log('3. The plugin should respond within a few seconds');
    }
    
    // Keep alive for 30 seconds to test message reception
    console.log('\nListening for incoming messages for 30 seconds...');
    
    setTimeout(async () => {
      if (messageReceived) {
        console.log('\n✅ SUCCESS: Message reception verified!');
      } else {
        console.log('\n⚠️  No messages received during test period.');
        console.log('Possible reasons:');
        console.log('- No one sent messages to the bot');
        console.log('- Message event not triggered');
        console.log('- Listener registration issue');
      }
      
      console.log('\nStopping client...');
      await client.stop();
      console.log('Test completed.');
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    console.error('❌ Connection verification failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

verifyConnection().catch(console.error);