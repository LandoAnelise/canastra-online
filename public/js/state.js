export const state = {
  myName: '',
  myRoomId: '',
  mySeatIndex: -1,
  gameState: null,
  selectedCards: [],
  myHandOrder: [],
  justDrawnCardId: null,
  readyPlayers: new Set(),
  iAmReady: false,
  amLeader: false,
  selectedRoomType: 'private',
  teamAssignments: {},
  dragSeat: null,
  teamsInitialized: false,
  stagedMelds: [],       // [{type:'new'|'add', cards:[...], meldIndex?}] during buraco first-meld staging
  stagedCardIds: new Set(), // card ids currently staged (removed from visible hand)
};
