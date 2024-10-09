// --------------------------------------------------------------------------------------
//    Code to demonstrate how MPLIB can be used to program a gridworld game
//    where players collect tokens.
// --------------------------------------------------------------------------------------

/* 

Graphics borrowed from: https://www.youtube.com/watch?v=xhURh2RDzzg&list=PLfO8lBNeR6KJiOQx1an2Le96DmcP3Ggqe&index=1

Issues:
* Collision detection is primitive: players can still move through each other. A transaction will needed to create foolproof collision detection 
* Name generation can collide

*/

// -------------------------------------
// Importing functions and variables from 
// the Firebase MultiPlayer library
// -------------------------------------
import {
  initializeMPLIB,
  joinSession,
  leaveSession,
  updateStateDirect,
  updateStateTransaction,  
  hasControl,
  readState,
  getCurrentPlayerId, getCurrentPlayerIds, getAllPlayerIds, getPlayerInfo,getNumberCurrentPlayers,getNumberAllPlayers,
  getCurrentPlayerArrivalIndex,getSessionId,anyPlayerTerminatedAbnormally,getSessionError,getWaitRoomInfo
} from "/mplib/src/mplib.js";

// -------------------------------------
//       Graphics handles
// -------------------------------------
let instructionsScreen = document.getElementById('instructionsScreen');
let waitingRoomScreen = document.getElementById('waitingRoomScreen');
let gameScreen = document.getElementById('gameScreen');
let messageWaitingRoom = document.getElementById('messageWaitingRoom');
let messageGame = document.getElementById('messageGame');
let messageFinish = document.getElementById('messageFinish');
let gameContainer = document.querySelector(".game-container");

// -------------------------------------
//       Session configuration
// -------------------------------------
// studyId is the name of the root node we create in the realtime database
const studyId = 'gridworld'; 

// Configuration setting for the session
let sessionConfig = {
    minPlayersNeeded: 1, // Minimum number of players needed; if set to 1, there is no waiting room (unless a countdown has been setup)
    maxPlayersNeeded: 4, // Maximum number of players allowed in a session
    maxParallelSessions: 0, // Maximum number of sessions in parallel (if zero, there are no limit)
    allowReplacements: true, // Allow replacing any players who leave an ongoing session?
    exitDelayWaitingRoom: 0, // Number of countdown seconds before leaving waiting room (if zero, player leaves waiting room immediately)
    maxHoursSession: 0, // Maximum hours where additional players are still allowed to be added to session (if zero, there is no time limit)
    recordData: true // Record all data?  
};
const verbosity = 2;

// Allow URL parameters to update these default parameters
updateConfigFromUrl( sessionConfig );

// List names of the callback functions that are used in this code (so MPLIB knows which functions to trigger)
let funList = { 
  sessionChangeFunction: {
      joinedWaitingRoom: joinWaitingRoom,
      updateWaitingRoom: updateWaitingRoom,
      startSession: startSession,
      updateOngoingSession: updateOngoingSession,
      endSession: endSession
  },
  receiveStateChangeFunction: receiveStateChange,
  removePlayerStateFunction: removePlayerState
};

// List the node names where we place listeners for any changes to the children of these nodes; set to '' if listening to changes for children of the root
let listenerPaths = [ 'coins' , 'players' ];

// Set the session configuration for MPLIB
initializeMPLIB( sessionConfig , studyId , funList, listenerPaths, verbosity );

// -------------------------------------
//       Game Globals
// -------------------------------------
let offsetY = 1;
let maxCoins = 10;

let mapData = {
  minX: 1,
  maxX: 19,
  minY: 1,
  maxY: 19,
  blockedSpaces: {  },
};

// Options for Player Colors... these are in the same order as our sprite sheet
const playerColors = ["blue", "orange", "yellow", "purple"];

let playerId;
let playerRef;
let players = {};
let playerElements = {};
let coins = {};
let coinElements = {};
let hasEnded = false;


// -------------------------------------
//       Event Listeners
// -------------------------------------
// Buttons
let joinButton = document.getElementById('joinBtn');
let leaveButton = document.getElementById('leaveBtn');

// Add event listeners to the buttons
joinButton.addEventListener('click', function () {
    joinSession(); // call the library function to attempt to join a session, this results either in starting a session directly or starting a waiting room
});

leaveButton.addEventListener('click', function () {
    leaveSession(); // call the library function to leave a session. This then triggers the local function endSession
});

class KeyPressListener {
  constructor(keyCode, callback) {
    this.keyCode = keyCode;
    this.callback = callback;
    this.keydownFunction = this.keydownFunction.bind(this);
    this.keyupFunction = this.keyupFunction.bind(this);

    document.addEventListener("keydown", this.keydownFunction);
    document.addEventListener("keyup", this.keyupFunction);
  }

  keydownFunction(event) {
    if (event.code === this.keyCode && activeKey === null) {
      activeKey = this.keyCode;
      this.callback();
    }
  }

  keyupFunction(event) {
    if (event.code === this.keyCode) {
      activeKey = null;
    }
  }

  unbind() {
    document.removeEventListener("keydown", this.keydownFunction);
    document.removeEventListener("keyup", this.keyupFunction);
  }
}

let activeKey = null;
  
// Declare the key listeners and store them in variables
let arrowUpListener = new KeyPressListener("ArrowUp", () => handleArrowPress(0, -1));
let arrowDownListener = new KeyPressListener("ArrowDown", () => handleArrowPress(0, 1));
let arrowLeftListener = new KeyPressListener("ArrowLeft", () => handleArrowPress(-1, 0));
let arrowRightListener = new KeyPressListener("ArrowRight", () => handleArrowPress(1, 0));

// -------------------------------------
//       Game Specific Code
// -------------------------------------
//Misc Helpers
function randomFromArray(array) {
  return array[Math.floor(Math.random() * array.length)];
}
function getKeyString(x, y) {
  return `${x}x${y}`;
}

// Function to get the first key for a given value
function getFirstKeyForValue(object, valueToMatch) {
  for (let key in object) {
    if (object[key] === valueToMatch) {
      return key; // Return immediately when the first match is found
    }
  }
  return null; // Return null if no match is found
}

function createName() {
  const prefix = randomFromArray([
    "COOL","SUPER","HIP","SMUG","COOL","SILKY","GOOD","SAFE","DEAR","DAMP","WARM","RICH","LONG","DARK","SOFT","BUFF","DOPE",
  ]);
  const animal = randomFromArray([
    "BEAR","DOG","CAT","FOX","LAMB","LION","BOAR","GOAT","VOLE","SEAL","PUMA","MULE","BULL","BIRD","BUG",
  ]);
  return `${prefix} ${animal}`;
}

function isOccupied(x,y) {

  const blockedNextSpace = mapData.blockedSpaces[getKeyString(x, y)];
  return (
    blockedNextSpace ||
    x > mapData.maxX ||
    x < mapData.minX ||
    y > mapData.maxY ||
    y < mapData.minY
  )
}


async function placeTokensForPlayer(playerId) {
  let player = players[playerId];
  if (!player) return;

  // Log player data for debugging
  console.log(`Placing tokens for player ${playerId}. Player data:`, player);

  let subgridPositions = [
    { xStart: 3, xEnd: 5, yStart: 3, yEnd: 5 },
    { xStart: 9, xEnd: 11, yStart: 3, yEnd: 5 },
    { xStart: 15, xEnd: 17, yStart: 3, yEnd: 5 },
    { xStart: 3, xEnd: 5, yStart: 9, yEnd: 11 },
    { xStart: 15, xEnd: 17, yStart: 9, yEnd: 11 },
    { xStart: 3, xEnd: 5, yStart: 15, yEnd: 17 },
    { xStart: 9, xEnd: 11, yStart: 15, yEnd: 17 },
    { xStart: 15, xEnd: 17, yStart: 15, yEnd: 17 },
  ];

  // Initialize or retrieve the current used subgrid for this player
  if (!player.currentSubgrid) {
    player.currentSubgrid = null;
  }

  // Collect all subgrids currently used by all players
  let allUsedSubgrids = Object.values(players)
    .map(p => (p.currentSubgrid != null) ? p.currentSubgrid - 1 : null); 
  // Log all used subgrids for debugging
  console.log(`All used subgrids by players:`, allUsedSubgrids);

  // Filter out subgrids used by other players, but include the player's own subgrid
  let availableSubgrids = subgridPositions.filter((_, index) => 
    !allUsedSubgrids.includes(index)
  );

  // Log available subgrids for debugging
  console.log(`Available subgrids for player ${playerId}:`, availableSubgrids);

  // Select a new subgrid randomly from the available ones
  let subgridIndex = Math.floor(Math.random() * availableSubgrids.length);
  let selectedSubgrid = availableSubgrids[subgridIndex];

  // Get the index of the selected subgrid to track it
  let subgridPositionIndex = subgridPositions.indexOf(selectedSubgrid);

  // Update the player's current subgrid in the database
  let path = `players/${playerId}`;
  let newState = {
    ...player,
    currentSubgrid: subgridPositionIndex + 1, // Store subgrid index with +1 offset
  };

  // Log the new subgrid for debugging
  console.log(`Assigning new subgrid ${subgridPositionIndex} to player ${playerId}`);

  await updateStateDirect(path, newState);

  let placedPositions = new Set(); // Track placed positions to avoid overlaps

  // Place three coins within the selected subgrid
  for (let i = 0; i < 3;) {
    let x = Math.floor(Math.random() * (selectedSubgrid.xEnd - selectedSubgrid.xStart + 1)) + selectedSubgrid.xStart;
    let y = Math.floor(Math.random() * (selectedSubgrid.yEnd - selectedSubgrid.yStart + 1)) + selectedSubgrid.yStart;
    let positionKey = `${x},${y}`;

    // Ensure the position is not occupied and not already used
    if (!isOccupied(x, y) && !placedPositions.has(positionKey)) {
      let id = `coins/${getKeyString(x, y)}`;
      let newState = { x, y, color: player.color, id: playerId }; // Set the coin color to match the player

      updateStateDirect(id, newState); // Save the new state in Firebase

      placedPositions.add(positionKey); // Mark this position as used
      i++; // Only increment after a successful placement
    }
  }

  // Log token placement for debugging
  console.log(`Placed tokens for player ${playerId} in subgrid ${subgridPositionIndex}`);
}



// // Handle token collection and place new groups when needed
// function handleCoinCollection(playerId) {
//   let player = players[playerId];
//   if (player.coins % 3 === 0) { // Check if the player collected a group of three
//     placeTokensForPlayer(playerId); // Place a new group of tokens
//   }
// }

async function handleCoinCollection(playerId) {
  let player = players[playerId];
  if (!player) return;

  // Fetch the current state of all coins from Firebase
  let currentCoins = await readState('coins');

  // Filter coins associated with the player by their color
  let playerCoins = Object.keys(currentCoins || {}).filter(
    (key) => currentCoins[key] && currentCoins[key].id === playerId
  );

  // Check if all coins for this player are removed
  if (playerCoins.length === 0) {
    // Log that all coins are collected
    console.log(`All coins collected for player ${playerId}. Placing a new group.`);

    // Place a new group of three coins
    await placeTokensForPlayer(playerId);
  }
}

async function getCoinData(key) {
  // Fetch the coin data from the correct path
  let coinData = await readState(`coins/${key}`);

  // // Log the retrieved data to ensure it's correct
  // console.log(`Retrieved Coin Data for ${key}:`, coinData);

  // Return the coin data, ensuring it's an object
  return coinData || {};
}


function handleArrowPress(xChange = 0, yChange = 0) {
  const oldX = players[playerId].x;
  const oldY = players[playerId].y;
  const newX = oldX + xChange;
  const newY = oldY + yChange;
  let newDirection = players[playerId].direction;

  if (
    newX >= 1 &&
    newX <= mapData.maxX &&
    newY >= 1 &&
    newY <= mapData.maxY
  ) {
    // Move to the next space
    if (xChange === 1) newDirection = "right";
    if (xChange === -1) newDirection = "left";

    // Generate the key to access the coin object
    const key = getKeyString(newX, newY);

    // Retrieve the coin data
    getCoinData(key).then((coin) => {
      // // Log the coin object to verify its structure
      // console.log(`Coin Object:`, coin);

      // Check if the coin object has a color property
      if (coin && coin.color) {
        // Log the colors for debugging
        // console.log(`Coin Color: ${coin.color}, Player Color: ${players[playerId].color}`);

        // Check if the coin's color matches the player's color
        if (coin.color.trim() === players[playerId].color.trim()) {
          // Update the player's coin count only if colors match
          players[playerId].coins = players[playerId].coins + 1;

          // Correct path to remove the coin from the state
          let path = `coins/${key}`;
          let newState = null;
          updateStateDirect(path, newState);

          // Handle collection logic, possibly placing new coins
          handleCoinCollection(playerId);
        } else {
          // Log the failed attempt to collect a mismatched coin
          // console.log(`Player ${playerId} tried to collect a coin of different color.`);
        }
      } else {
        // console.log(`The coin does not have a color property or it is undefined.`);
      }
    }).catch((error) => {
      // console.log(`Error retrieving coin data for ${key}:`, error);
    });

    // Broadcast this new player position to the database
    let path = `players/${playerId}`;
    let newState = {
      direction: newDirection,
      oldX: oldX,
      oldY: oldY,
      x: newX,
      y: newY,
      coins: players[playerId].coins,
    };
    updateStateDirect(path, newState);
  }
}


async function assignUniqueColor() {
  // Fetch all current players from the Firebase database
  let players = await readState('players');
  let usedColors = new Set();

  // Collect all colors that are currently being used
  if (players !== null) {
    Object.values(players).forEach(player => {
      if (player.color) {
        usedColors.add(player.color);
      }
    });
  }

  // Find the first available color that isn't used
  let availableColor = playerColors.find(color => !usedColors.has(color));
  if (!availableColor) {
    console.error('No available colors left for players!');
    return null;
  }

  return availableColor;
}

// Helper function to determine the correct filter value based on the color
function getFilterForColor(color) {
  switch (color) {
    case 'blue':
      return 'sepia(1) saturate(4000%) hue-rotate(150deg) brightness(1) contrast(2)'; // Blue filter
    case 'orange':
      return 'sepia(1) saturate(5000%) hue-rotate(293deg) brightness(0.9) contrast(1.6)';  // Orange filter
    case 'yellow':
      return 'sepia(1) saturate(4000%) hue-rotate(2deg) brightness(1.2) contrast(1.1)'; // yellow filter
    case 'purple':
      return 'sepia(1) saturate(5000%) hue-rotate(182deg) brightness(0.8) contrast(1.1)'; // Purple filter
  }
}

function shuffle(array) {
  let currentIndex = array.length, randomIndex;

  // While there remain elements to shuffle
  while (currentIndex !== 0) {
    // Pick a remaining element
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // Swap it with the current element
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }

  return array;
}

// Function to render a door on the grid as a rectangle
function renderDoor(x, y, color, side) {
  const doorElement = document.createElement("div");
  doorElement.classList.add("Door");

  // Set door background color
  doorElement.style.backgroundColor = color;

  // Adjust door position with appropriate offsets based on side
  let left = 16 * (x - 1) + "px"; // Default left position
  let top = 16 * (y - 1) + "px";  // Default top position

  // Adjust the width/height based on the side
  if (side === 'top' || side === 'bottom') {
    doorElement.style.width = '18px';
    doorElement.style.height = '4px';  // Horizontal door

    // Adjust position for top or bottom alignment
    left = 16 * (x - 1) - 1 + "px";  // Center it horizontally

    if (side === 'top') {
      top = 16 * (y -1) - 1 + "px";  // Move slightly up for top door
    } else if (side === 'bottom') {
      top = 16 * (y - 1) + 13 + "px";  // Move slightly down for bottom door
    }

  } else if (side === 'left' || side === 'right') {
    doorElement.style.width = '4px';
    doorElement.style.height = '18px'; // Vertical door

    // Adjust position for left or right alignment
    top = 16 * (y - 1) - 1 + "px";  // Center it vertically

    if (side === 'left') {
      left = 16 * (x - 1) - 1 + "px";  // Move slightly left for left door
    } else if (side === 'right') {
      left = 16 * (x - 1) + 13 + "px";  // Move slightly right for right door
    }
  }

  // Apply the calculated positions
  doorElement.style.transform = `translate3d(${left}, ${top}, 0)`;

  // Append the door to the game container
  document.querySelector(".game-container").appendChild(doorElement);
}

// Modified function to place doors around each subgrid
function placeDoorsForSubgrid(subgridIndex) {
  let subgridPositions = [
    { xStart: 3, xEnd: 5, yStart: 3, yEnd: 5 },
    { xStart: 9, xEnd: 11, yStart: 3, yEnd: 5 },
    { xStart: 15, xEnd: 17, yStart: 3, yEnd: 5 },
    { xStart: 3, xEnd: 5, yStart: 9, yEnd: 11 },
    { xStart: 15, xEnd: 17, yStart: 9, yEnd: 11 },
    { xStart: 3, xEnd: 5, yStart: 15, yEnd: 17 },
    { xStart: 9, xEnd: 11, yStart: 15, yEnd: 17 },
    { xStart: 15, xEnd: 17, yStart: 15, yEnd: 17 },
  ];

  const subgrid = subgridPositions[subgridIndex];

  const doorPositions = [
    { x: (subgrid.xStart + subgrid.xEnd) / 2, y: subgrid.yStart, side: 'top' },    // Top Door
    { x: (subgrid.xStart + subgrid.xEnd) / 2, y: subgrid.yEnd, side: 'bottom' },   // Bottom Door
    { x: subgrid.xStart, y: (subgrid.yStart + subgrid.yEnd) / 2, side: 'left' },   // Left Door
    { x: subgrid.xEnd, y: (subgrid.yStart + subgrid.yEnd) / 2, side: 'right' }     // Right Door
  ];

  let doorColors = ['yellow', 'orange', '#00CCFF', '#9370DB'];

  let shuffledColors = shuffle(doorColors);

  // Loop through each door and place it on the grid with the shuffled color
  doorPositions.forEach((door, index) => {
    renderDoor(door.x, door.y, shuffledColors[index], door.side);
  });
}

function placeDoorsForAllSubgrids() {
  for (let i = 0; i < 8; i++) {
    placeDoorsForSubgrid(i);
  }
}



async function initGame() {

    placeDoorsForAllSubgrids() 
    // Get the id of this player
    playerId = getCurrentPlayerId();

    // Read the current state under 'players' and get a list of all current player names (not their ids)
    let pathState = 'players';
    let players = await readState( pathState ); 
    let playerNames = [];
    if (players !== null) {
       playerNames = Object.values(players).map(player => player.name);
    }
    
    // Select a name that has not been used before
    let name;
    do {
        name = createName(); 
    } while (playerNames.includes( name ));

    let color = await assignUniqueColor(); // Get a unique color for the player
    if (!color) return; // Exit if no color is available
 
    // Show the player name
    let str = `You are: ${name}`;
    messageGame.innerHTML = str;
    
    const {x, y} = { x: 1, y: 1 }; 
    
    // Broadcast this new player position to the database
    let path = `players/${playerId}`;
    let newState = {
          id: playerId,
          name,
          direction: "right",
          color: color, 
          oldX: x,
          oldY: y,
          x,
          y,
          coins: 0,
        };
    updateStateDirect(path, newState);

    // Place first coin
    placeTokensForPlayer(playerId);
}

// --------------------------------------------------------------------------------------
//   Handle state change events triggered by MPLIB
// --------------------------------------------------------------------------------------

// Function to receive state changes from Firebase (broadcast by other players)
function receiveStateChange(pathNow,nodeName, newState, typeChange ) {
  // typeChange can be the following:
  //  'onChildChanged'
  //  'onChildAdded'
  //  'onChildRemoved'

  // Adding a player
  if ((pathNow === "players") && (typeChange == 'onChildAdded')) {
      const addedPlayer = newState; 
      const characterElement = document.createElement("div");
      characterElement.classList.add("Character", "grid-cell");
      characterElement.innerHTML = (`
        <div class="Character_shadow grid-cell"></div>
        <div class="Character_sprite grid-cell"></div>
        <div class="Character_name-container">
          <span class="Character_name"></span>
          <span class="Character_coins">0</span>
        </div>
      `);

      playerElements[addedPlayer.id] = characterElement;

      //Fill in some initial state
      characterElement.querySelector(".Character_name").innerText = addedPlayer.name;
      characterElement.querySelector(".Character_coins").innerText = addedPlayer.coins;
      characterElement.setAttribute("data-color", addedPlayer.color);
      characterElement.setAttribute("data-direction", addedPlayer.direction);
      const left = 16 * (addedPlayer.x-1) + "px";
      const top = 16 * (addedPlayer.y-1) - offsetY + "px";
      characterElement.style.transform = `translate3d(${left}, ${top}, 0)`;
      gameContainer.appendChild(characterElement);

      // Update local game state
      let newRef = getKeyString(addedPlayer.x, addedPlayer.y);
      mapData.blockedSpaces[ newRef ] = addedPlayer.id;

      players[ addedPlayer.id ] = addedPlayer;
  }

  // A change in a player that already exists
  if ((pathNow === "players") && (typeChange == 'onChildChanged')) {
      const changedPlayer = newState;
      const characterState = changedPlayer;
      let el = playerElements[changedPlayer.id];
      // Now update the DOM
      el.querySelector(".Character_name").innerText = characterState.name;
      el.querySelector(".Character_coins").innerText = characterState.coins;
      el.setAttribute("data-color", characterState.color);
      el.setAttribute("data-direction", characterState.direction);
      const left = 16 * (characterState.x-1) + "px";
      const top = 16 * (characterState.y-1) - offsetY + "px";
      el.style.transform = `translate3d(${left}, ${top}, 0)`;

      // Update local game state
      if ((characterState.x != characterState.oldX) || (characterState.y != characterState.oldY)) {
          let newRef = getKeyString(characterState.x, characterState.y);
          mapData.blockedSpaces[newRef] = changedPlayer.id;

          let oldRef = getKeyString(characterState.oldX, characterState.oldY);
          delete mapData.blockedSpaces[oldRef];
      }

      players[ changedPlayer.id ] = changedPlayer;
  }

  // Removing a player
  if ((pathNow === "players") && (typeChange == 'onChildRemoved')) {
      const removedPlayerId = nodeName;
      gameContainer.removeChild(playerElements[removedPlayerId]);
      delete playerElements[removedPlayerId];

      // Remove player from local game state
      let firstMatchingKey = getFirstKeyForValue(mapData.blockedSpaces, removedPlayerId);
      delete mapData.blockedSpaces[firstMatchingKey];

      delete players[removedPlayerId];
  }


  // Adding a coin
  if ((pathNow === "coins") && (typeChange == 'onChildAdded')) {
      const coin = newState;
      const key = nodeName;
      coins[key] = true;

      // Create the DOM Element
      const coinElement = document.createElement("div");
      coinElement.classList.add("Coin", "grid-cell");
      coinElement.innerHTML = `
        <div class="Coin_shadow grid-cell"></div>
        <div class="Coin_sprite grid-cell" style="filter: ${getFilterForColor(coin.color)};"></div>
      `;

      // Position the Element
      const left = 16 * (coin.x-1) + "px";
      const top = 16 * (coin.y-1) - offsetY + "px";
      coinElement.style.transform = `translate3d(${left}, ${top}, 0)`;

      // Keep a reference for removal later and add to DOM
      coinElements[key] = coinElement;
      gameContainer.appendChild(coinElement);
  }

  // Removing a coin
  if ((pathNow === "coins") && (typeChange == 'onChildRemoved')) {
      const key = nodeName;
      delete coins[key];
      gameContainer.removeChild( coinElements[key] );
      delete coinElements[key];
  }
}

// Function triggered by a call to "updateStateTransaction" to evaluate if the proposed action is valid
// If "updateStateTransaction" is not called, and all updates are done through "updateStateDirect", there is no 
// need for this function
function evaluateUpdate( path, state, action, actionArgs ) {
  let isAllowed = false;
  let newState = null;

  // .... insert your code to update isAllowed and newState

  let evaluationResult = { isAllowed, newState };
  return evaluationResult;
}

// Function triggered when this client closes the window and the player needs to be removed from the state 
function removePlayerState() {
  // Send a null state to this player in the database, which removes the database entry
  let path = `players/${getCurrentPlayerId()}`;
  let newState = null;
  updateStateDirect( path, newState);
}

// --------------------------------------------------------------------------------------
//   Handle any session change relating to the waiting room or ongoing session 
// --------------------------------------------------------------------------------------

function joinWaitingRoom() {
  /*
      Functionality to invoke when joining a waiting room.

      This function does the following:
          - Get the current player's playerId
          - Determines the number of players needed for the game
          - Creates an appropriate message based on players needed and players in waiting room
          - Displays the waiting room screen
  */

  let playerId = getCurrentPlayerId(); // the playerId for this client
  let numPlayers = getNumberCurrentPlayers(); // the current number of players
  let numNeeded = sessionConfig.minPlayersNeeded - numPlayers; // Number of players still needed (in case the player is currently in a waiting room)
  
  let str2 = `Waiting for ${ numNeeded } additional ${ numPlayers > 1 ? 'players' : 'player' }...`;
  messageWaitingRoom.innerText = str2;
  
  // switch screens from instruction to waiting room
  instructionsScreen.style.display = 'none';
  waitingRoomScreen.style.display = 'block';
}

function updateWaitingRoom() {
  /*
      Functionality to invoke when updating the waiting room.

      This function does the following:
          - Displays the waiting room screen
          - Checks the status of the waiting room through the getWaitRoomInfo() function
              - If the flag doCountDown is true, then the game will start after a countdown
              - otherwise continue waiting
          - Displays a 'game will start' message if appropriate
  */
 
  // switch screens from instruction to waiting room
  instructionsScreen.style.display = 'none';
  waitingRoomScreen.style.display = 'block';

  // Waiting Room is full and we can start game
  let [ doCountDown , secondsLeft ] = getWaitRoomInfo();
  if (doCountDown) {
      let str2 = `Game will start in ${ secondsLeft } seconds...`;
      messageWaitingRoom.innerText = str2;
  } else { // Still waiting for more players, update wait count
      let numPlayers = getNumberCurrentPlayers(); // the current number of players
      let numNeeded = sessionConfig.minPlayersNeeded - numPlayers; // Number of players still needed (in case the player is currently in a waiting room)
      
      let str2 = `Waiting for ${ numNeeded } additional ${ numPlayers > 1 ? 'players' : 'player' }...`;
      messageWaitingRoom.innerText = str2;
  }
}

function startSession() {
  /*
      Funtionality to invoke when starting a session.

      This function does the following:
          - Displays the game screen
          - Display the scene
          - Logs the start of the game with the session ID and timestamp
          - Start an event listener for key presses that control the avatar
          - Add client player (this user) avatar
          - Tell the client which player they are
          - Starts a new game
  */

  instructionsScreen.style.display = 'none';
  waitingRoomScreen.style.display = 'none';
  gameScreen.style.display = 'block';
  
  let playerId = getCurrentPlayerId(); // the playerId for this client
  let dateString = timeStr(getPlayerInfo( playerId ).sessionStartedAt);
  let str = `Started game with session id ${getSessionId()} with ${getNumberCurrentPlayers()} players at ${dateString}.`;
  myconsolelog( str );
  
  // Add the event listener for key presses
  //document.addEventListener('keydown', handleKeyDown);

  //let str2 = `You are: Player${getCurrentPlayerArrivalIndex()}`;
  //messageGame.innerHTML = str2;

  initGame();
}

function updateOngoingSession() {
  /*
      Functionality to invoke when updating an ongoing session.

      This function is currently empty.
  */
}

function endSession() {
  /*
      Functionality to invoke when ending a session.

      This function does the following:
          - Displays the finish screen (hides all other divs)
          - Hide and disable the scene
          - Remove the keypress event listener
          - Checks if any players terminated their session abnormally
              - If so, an "abnormal termination" message is created
              - If not, then the session completed normally
          - Displays a message based on the termination status [normal, abnormal]
  */
  instructionsScreen.style.display = 'none';
  waitingRoomScreen.style.display = 'none';
  gameScreen.style.display = 'none';
  finishScreen.style.display = 'block';

  // Remove the key listeners
  arrowUpListener.unbind();
  arrowDownListener.unbind();
  arrowLeftListener.unbind();
  arrowRightListener.unbind();

  // Set a flag
  hasEnded = true;

  let err = getSessionError();

  if (err.errorCode == 1) {
      // No sessions available
      messageFinish.innerHTML = `<p>Session ended abnormally because there are no available sessions to join</p>`;
  } else if (err.errorCode==2) {
      // This client was disconnected (e.g. internet connectivity issues) 
      messageFinish.innerHTML = `<p>Session ended abnormally because you are experiencing internet connectivity issues</p>`;
  } else if (err.errorCode==3) {
      // This client is using an incompatible browser
      messageFinish.innerHTML = `<p>Session ended abnormally because you are using the Edge browser which is incompatible with this experiment. Please use Chrome or Firefox</p>`;
  } else {
      messageFinish.innerHTML = `<p>You have completed the session.</p>`;
  }
}

// -------------------------------------------------------------------------------------
//       Handle events triggered by MPLIB related to changes in the game state
// -------------------------------------------------------------------------------------


// -------------------------------------
//       Display Information
// -------------------------------------
function myconsolelog(message) {
  if (verbosity > 0) {
      console.log(message);
  }
}


// Converts the server-side timestamp expressed in milliseconds since the Unix Epoch to a string in local time
function timeStr(timestamp) {
  let date = new Date(timestamp);  // JavaScript uses milliseconds

  // Add leading zero to hours, minutes, and seconds if they are less than 10
  let hours = ("0" + date.getHours()).slice(-2);
  let minutes = ("0" + date.getMinutes()).slice(-2);
  let seconds = ("0" + date.getSeconds()).slice(-2);

  let timeString = `${hours}:${minutes}:${seconds}`;
  return timeString;
}

// Takes the URL parameters to update the session configuration
function updateConfigFromUrl( sessionConfig ) {
  const url = window.location.href;
  const urlParams = new URL(url).searchParams;

  for (let key in sessionConfig) {
      if (urlParams.has(key)) {
          const value = urlParams.get(key);

          let newValue;
          if (!isNaN(value)) {
              newValue = Number(value);
          }
          else if (value === 'true' || value === 'false') {
              newValue = (value === 'true');
          }
          // if not a number or boolean, treat it as a string
          else {
              newValue = value;              
          }
          sessionConfig[key] = newValue;
          myconsolelog( `URL parameters update session parameter ${key} to value ${newValue}`);
      }
  }
}

function removePrefix(str, prefix) {
  if (str.startsWith(prefix)) {
    return str.substring(prefix.length);
  }
  return str;
}