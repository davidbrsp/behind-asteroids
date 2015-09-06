/* global
DEBUG
MOBILE
smoothstep
normAngle
font
path
glCreateFBO
glCreateShader
glCreateTexture
glUniformLocation
glBindFBO
glBindShader
glGetFBOTexture
glBindTexture
glSetTexture
c
d
u
g
STATIC_VERT
BLUR1D_FRAG
COPY_FRAG
GAME_FRAG
GLARE_FRAG
LASER_FRAG
PERSISTENCE_FRAG
PLAYER_FRAG
audio
play
*/



/* TODO list
- Polish the AI
- audio
- game features (if time)
  - UFO "bonus"
*/

var gl = c.getContext("webgl"),
  ctx,
  gameCtx = g.getContext("2d"),
  uiCtx = u.getContext("2d"),
  FW = MOBILE ? 480 : 800,
  FH = MOBILE ? 600 : 680,
  GAME_MARGIN = MOBILE ? 50 : 120,
  GAME_TOP_MARGIN = MOBILE ? 140 : GAME_MARGIN,
  GAME_INC_PADDING = MOBILE ? 40 : 80,
  W = FW - 2 * GAME_MARGIN,
  H = FH - GAME_MARGIN - GAME_TOP_MARGIN,
  borderLength = 2*(W+H+2*GAME_INC_PADDING),
  SEED = Math.random(),
  excitementSmoothed = 0,
  nevedPlayed = 1;

d.style.width = FW + "px";
g.width = c.width = W;
g.height = c.height = H;
c.style.top = GAME_TOP_MARGIN + "px";
c.style.left = GAME_MARGIN + "px";

var uiScale = MOBILE ? 1 : devicePixelRatio; // MOBILE is just too slow to do devicePixelRatio..
u.width = FW * uiScale;
u.height = FH * uiScale;
u.style.width = FW + "px";
u.style.height = FH + "px";

var lastHalf = 0;
function checkSize () {
  var half = Math.floor((innerHeight-FH)/2);
  if (half !== lastHalf) {
    lastHalf = half;
    d.style.marginTop = half + "px";
  }
}

// sounds

// TODO: async?

var Ashot = audio([0,0.06,0.18,,0.33,0.5,0.23,-0.04,-0.24,,,-0.02,,0.37,-0.2199,,,,0.8,,,,,0.3]);

var Amusic1 = audio([,,0.12,,0.13,0.16,,,,,,,,,,,,,0.7,,,,,0.5]);
var Amusic2 = audio([,,0.12,,0.13,0.165,,,,,,,,,,,,,0.7,,,,,0.5]);

var Aexplosion1 = audio([3,,0.35,0.5369,0.5,0.15,,-0.02,,,,-0.7444,0.78,,,0.7619,,,0.1,,,,,0.5]);
var Aexplosion2 = audio([3,,0.38,0.5369,0.52,0.18,,-0.02,,,,-0.7444,0.78,,,0.7619,,,0.1,,,,,0.5]);

var Asend = audio([2,0.07,0.04,,0.24,0.25,,0.34,-0.1999,,,-0.02,,0.3187,,,-0.14,0.04,0.85,,0.28,0.63,,0.5]);
var AsendFail = audio([1,,0.04,,0.45,0.14,0.06,-0.06,0.02,0.87,0.95,-0.02,,0.3187,,,-0.14,0.04,0.5,,,,,0.4]);

var Alost = audio([0,0.11,0.37,,0.92,0.15,,-0.06,-0.04,0.29,0.14,0.1,,0.5047,,,,,0.16,-0.02,,,,0.3]);

// set up WebGL layer

// WebGL setup

gl.viewport(0, 0, W, H);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

var buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1.0, -1.0,
  1.0, -1.0,
  -1.0,  1.0,
  -1.0,  1.0,
  1.0, -1.0,
  1.0,  1.0
]), gl.STATIC_DRAW);

var blur1dShader = glCreateShader(STATIC_VERT, BLUR1D_FRAG);
gl.uniform2f(glUniformLocation(blur1dShader, "dim"), W, H);
var copyShader = glCreateShader(STATIC_VERT, COPY_FRAG);
var laserShader = glCreateShader( STATIC_VERT, LASER_FRAG);
var persistenceShader = glCreateShader(STATIC_VERT, PERSISTENCE_FRAG);
var glareShader = glCreateShader(STATIC_VERT, GLARE_FRAG);
var playerShader = glCreateShader(STATIC_VERT, PLAYER_FRAG);
gl.uniform1f(glUniformLocation(playerShader, "S"), SEED);
var gameShader = glCreateShader(STATIC_VERT, GAME_FRAG);

var persistenceFbo = glCreateFBO();
var playerFbo = glCreateFBO();
var glareFbo = glCreateFBO();
var laserFbo = glCreateFBO();
var fbo1 = glCreateFBO();
var fbo2 = glCreateFBO();

var textureGame = glCreateTexture();



/// GAME STATE

var t = 0, dt,

  spaceship = [ W/2, H/2, 0, 0, 0 ], // [x, y, velx, vely, rot]
  asteroids = [], // array of [x, y, rot, vel, shape, lvl]
//  aliens = []; // array of [x, y, rot, vel]
  bullets = [], // array of [x, y, velx, vely, life, isAlien]
  incomingObjects = [], // array of: [pos, vel, ang, force, rotVel, shape, lvl, key, rotAmp, rotAmpValid, explodeTime]
  particles = [], // array of [x, y, rot, vel, life]

  dying = 0,
  resurrectionTime = 0,
  best = 0,
  score = 0,
  scoreForLife = 0,
  playingSince = -10000,
  deads = 0,
  player = 0,
  lifes = 0,

  AIshoot = 0, AIboost = 0, AIrotate = 0, AIexcitement = 0;

randomAsteroids();

// user inputs
var keys = {};
for (var i=0; i<99; ++i) keys[i] = 0;
var tap; // [x,y], is cleaned by the update loop

if (MOBILE) {
  addEventListener("touchstart", function (e) {
    e.preventDefault();
    var r = c.getBoundingClientRect();
    e = e.changedTouches[0];
    var x = e.clientX-r.left;
    var y = e.clientY-r.top;
    tap = [ x, y ];
  });
}
else {
  addEventListener("keydown", function (e) {
    keys[e.which] = 1;
  });
  addEventListener("keyup", function (e) {
    keys[e.which] = 0;
  });
}

// game actions


function sendAsteroid (o) {
  if (Math.abs(Math.cos(o[2])) < o[9]) {
    var p = incPosition(o);
    var rot = incRotation(o);
    var x = Math.max(0, Math.min(p[0], W));
    var y = Math.max(0, Math.min(p[1], H));
    var vel = 0.005 * o[3] * (0.5 + 0.5 * Math.random());
    var lvl = o[6];
    var shape = o[5];
    asteroids.push([ x, y, rot, vel, shape, lvl ]);
    play(Asend);
    return 1;
  }
  else {
    play(AsendFail);
  }
}

function randomAsteroids () {
  asteroids = [];
  for (var i=0; i<8; ++i) {
    var lvl = Math.floor(1.5 + 3 * Math.random());
    asteroids[i] = [
      W * Math.random(),
      H * Math.random(),
      2 * Math.PI * Math.random(),
      0.02 + 0.02 * Math.random(),
      randomAsteroidShape(lvl),
      lvl
    ];
  }
}

function randomInGameAsteroid () {
  var a = Math.random() < 0.5;
  var b = Math.random() < 0.5;
  var lvl = Math.floor(1 + 2 * Math.random() * Math.random());
  asteroids.push([
    a ? (b?-20:W+20) : W * Math.random(),
    !a ? (b?-20:H+20) : H * Math.random(),
    2 * Math.PI * Math.random(),
    0.02 + 0.02 * Math.random(),
    randomAsteroidShape(lvl),
    lvl
  ]);
}

function maybeCreateInc () {
  var sum = incomingObjects.reduce(function (sum, o) {
    return o[6];
  }, 0);
  // create inc is ruled with probabilities
  if (Math.random() <
    0.01 * dt * // continous time probability
    Math.exp(-sum * // more there is object, more it is rare to create new ones
    (1 + Math.exp(-(player-1)/2)) // first rounds have less items
    ) *
    (1 - Math.exp(-playingSince / 15000)) * // 0% to 50% in 0 to 10 sec of beginning
    (
      0.5 +
      0.5 * Math.exp(-Math.max(0, (player-10)/10)) // items decrease after round 10
    )
  )
    return createInc();
}

function createInc () {
  var pos = Math.random() * borderLength;
  var takenKeys = [], i;
  for (i=0; i<incomingObjects.length; ++i) {
    var o = incomingObjects[i];
    var p = o[0] % borderLength;
    if (pos - 60 < p && p < pos + 60) return 0;
    takenKeys.push(o[7]);
  }
  var availableKeys = [];
  for (i = 65; i<91; i++) {
    if (takenKeys.indexOf(i) == -1)
      availableKeys.push(i);
  }
  if (!availableKeys.length) return 0;

  /*
  PARAMS to vary with game difficulty
  - higher rotation amplitude
  - lower rotation valid amp ratio
  - higher rotation speed
  */

  var diffMax = 1-Math.exp(-player/5);
  var diffMin = 1-Math.exp((1-player)/20);
  if (Math.random() > diffMax) diffMin *= Math.random();

  var pRotAmp = diffMin + Math.random() * (diffMax-diffMin);
  var pRotAmpRatio = diffMin + Math.random() * (diffMax-diffMin);
  var pRotSpeed = diffMin + Math.random() * (diffMax-diffMin);

  var ampRot = Math.PI * (0.5 * Math.random() + 0.5 * Math.random() * pRotAmp) * pRotAmp;

  var lvl = Math.floor(2 + 3 * Math.random() * Math.random() + 4 * Math.random() * Math.random() * Math.random());

  incomingObjects.push([
    pos,
    // velocity
    0.1,
    // initial angle
    2*Math.PI*Math.random(),
    // initial force
    30*Math.random(),
    // rot velocity
    0.002 + 0.001 * (Math.random() + 0.5 * lvl * Math.random()) * pRotSpeed - 0.001 * pRotAmp,
    // shape
    randomAsteroidShape(lvl),
    // level
    lvl,
    // key
    availableKeys[Math.floor(Math.random() * availableKeys.length)],
    // amplitude rotation
    ampRot,
    // amplitude rotation valid ratio
    ampRot > 0.8-pRotAmpRatio ? 1 - 0.6 * pRotAmpRatio - 0.2 * pRotAmp : 1,
    // explode time
    0
  ]);
  return 1;
}

function randomAsteroidShape (lvl) {
  var n = 4 + lvl * 2;
  var size = lvl * 10;
  var pts = [];
  for (var i = 0; i < n; ++i) {
    var l = size*(0.4 + 0.6 * Math.random());
    var a = 2 * Math.PI * i / n;
    pts.push([
      l * Math.cos(a),
      l * Math.sin(a)
    ]);
  }
  return pts;
}

function explose (o) {
  play(Math.random()<0.5 ? Aexplosion1 : Aexplosion2);
  var n = Math.floor(9 + 9 * Math.random());
  for (var i = 0; i < n; ++i) {
    var l = 20 * Math.random();
    var a = (Math.random() + 2 * Math.PI * i) / n;
    particles.push([
      o[0] + l * Math.cos(a),
      o[1] + l * Math.sin(a),
      a,
      0.06,
      Math.random()<0.3 ? 0 : 1000
    ]);
  }
}

function explodeAsteroid (j) {
  var aster = asteroids[j];
  asteroids.splice(j, 1);
  var lvl = aster[5];
  if (lvl > 1) {
    var nb = Math.round(2+1.5*Math.random());
    for (var k=0; k<nb; k++) {
      var a = Math.random() + 2 * Math.PI * k / nb;
      asteroids.push([
        aster[0] + 10 * Math.cos(a),
        aster[1] + 10 * Math.sin(a),
        a,
        0.8 * aster[3],
        randomAsteroidShape(lvl-1),
        lvl - 1
      ]);
    }
  }
}

// GAME LOGIC

function euclidPhysics (obj) {
  obj[0] += obj[2] * dt;
  obj[1] += obj[3] * dt;
}

function polarPhysics (obj) {
  var x = Math.cos(obj[2]);
  var y = Math.sin(obj[2]);
  var s = dt * obj[3];
  obj[0] += s * x;
  obj[1] += s * y;
}

function destroyOutOfBox (obj, i, arr) {
  var B = 100;
  if (obj[0] < -B || obj[1] < -B || obj[0] > W+B || obj[1] > H+B) {
    arr.splice(i, 1);
  }
}

function applyLife (obj, i, arr) {
  if ((obj[4] -= dt) < 0) {
    arr.splice(i, 1);
  }
}

function loopOutOfBox (obj) {
  if (obj[0] < 0) {
    obj[0] += W;
  }
  else if (obj[0] > W) {
    obj[0] -= W;
  }
  if (obj[1] < 0) {
    obj[1] += H;
  }
  else if (obj[1] > H) {
    obj[1] -= H;
  }
}

function circleCollides (a, b, r) {
  var x = a[0] - b[0];
  var y = a[1] - b[1];
  return x*x+y*y < r*r;
}

function spaceshipDie() {
  if (dying) return;
  dying = t;
  deads ++;
}

function dist (a, b) { // REMOVE and replace by length?
  var x = a[0]-b[0];
  var y = a[1]-b[1];
  return Math.sqrt(x * x + y * y);
}
function length (v) {
  return Math.sqrt(v[0]*v[0]+v[1]*v[1]);
}

/*
function resetSpaceship () {
  var x = W * (0.25 + 0.5 * Math.random());
  var y = H * (0.25 + 0.5 * Math.random());
  spaceship = [x, y, 0, 0];
}
*/

function applyIncLogic (o) {
  if (!o[10]) {
    o[0] += 0.1 * dt;
    o[2] += o[4] * dt;
    o[3] = o[3] < 10 ? 60 : o[3] * (1 - 0.0008 * dt);
  }
}

// AI states
// q1 and q2 are 2 quality expertise of the player
function aiLogic (q1, q2) { // set the 3 AI inputs (rotate, shoot, boost)
  var x, y, ang;
  var prevRot = AIrotate;
  var prevBoost = AIboost;
  AIrotate = 0;
  AIshoot = 0;
  AIboost = 0;

  // first part is data extraction / analysis

  var ax = Math.cos(spaceship[4]);
  var ay = Math.sin(spaceship[4]);
  var vel = Math.sqrt(spaceship[2]*spaceship[2]+spaceship[3]*spaceship[3]);

  var deltaMiddle = [W/2-spaceship[0], H/2-spaceship[1]];
  var distMiddle = length(deltaMiddle);
  var angMiddle = Math.atan2(deltaMiddle[1], deltaMiddle[0]);

  var pred = 100 + 500 * Math.random();
  var predSpaceship = [
    spaceship[0] + pred * spaceship[2],
    spaceship[1] + pred * spaceship[3]
  ];

  var danger = 0;
  var closestAsteroid, closestAsteroidPredDist;
  var targetAsteroid, targetAsteroidWeight;

  for (i = 0; i < asteroids.length; ++i) {
    var a = asteroids[i];
    if (!(a[0]<0 || a[1]<0 || a[0]>W || a[1]>H)) {
      var aPred = [].concat(a);
      aPred[0] += Math.cos(a[2]) * a[3] * pred;
      aPred[1] += Math.sin(a[2]) * a[3] * pred;
      var curDist = dist(a, spaceship) - (10 + 10 * a[5]);
      var predDist = dist(aPred, predSpaceship) - (10 + 10 * a[5]);
      if (curDist - predDist > pred / 200 && // approaching
        (curDist < 80 || predDist < 30 + 30 * q2)) {
        // imminent collision
        if (!closestAsteroid || predDist < closestAsteroidPredDist) {
          closestAsteroid = a;
          targetAsteroid = a;
          closestAsteroidPredDist = predDist;
          danger ++;
        }
      }
    }

    if (!(a[5] > 2 && curDist < 30) || predDist < 100) {
      var w = a[5];
      if (!closestAsteroid || w < targetAsteroidWeight) {
        targetAsteroid = aPred;
        targetAsteroidWeight = w;
      }
    }
  }

  // utility

  function opp (dx, dy) { // going opposite of a vector based on current head direction
    return (ax > ay) ?
      ((ax<0)==(dx<0) ? -1 : 1) :
      ((ay<0)==(dy<0) ? -1 : 1);
  }

  AIexcitement =
    (1 - Math.exp(-asteroids.length/10)) + // total asteroids
    (1 - Math.exp(-danger/3)) // danger
  ;

  // Now we implement the spaceship reaction
  // From the least to the most important reactions


  // Random changes

  AIshoot = playingSince > 3000 && Math.random() < 0.0001*dt*AIexcitement;

  AIrotate = (playingSince > 1000 && Math.random()<0.005*dt) ?
    (Math.random()<0.5 ? 0 : Math.random()<0.5 ? 1 : -1) :
    prevRot;

  AIboost = (playingSince > 2000 && Math.random()<0.005*dt*(1-q1)) ?
    (Math.random()<0.5 ? 1 : -1) :
    prevBoost;


  // trying to avoid edges

  if (distMiddle > 100 - 80 * q2) {
    ang = normAngle(angMiddle-spaceship[4]);
    if (Math.abs(ang) > 2*Math.PI/3) {
      AIboost = -1;
    }
    else if (Math.abs(ang) > Math.PI/3) {
      AIrotate = ang<0 ? -1 : 1;
    }
    else {
      AIboost = 1;
    }
  }

  // Slowing down
  if (
    -Math.exp(-distMiddle/80) + // slow down if middle
    Math.exp(-vel) + // slow down if velocity
    (1-q1) * AIexcitement * Math.random() // excitement make it not slowing down
    < Math.random()) {
    AIboost = opp(spaceship[2], spaceship[3]);
  }

  if (closestAsteroid && q1>Math.random()-0.02*dt) {
    x = closestAsteroid[0]-spaceship[0];
    y = closestAsteroid[1]-spaceship[1];
    AIboost = opp(x, y);
  }

  if (targetAsteroid && q2>Math.random()-0.01*dt) {
    x = targetAsteroid[0]-spaceship[0];
    y = targetAsteroid[1]-spaceship[1];
    ang = normAngle(Math.atan2(y, x)-spaceship[4]);
    var angabs = Math.abs(ang);
    if (Math.random() < 0.06*dt*angabs) AIrotate = ang > 0 ? 1 : -1;
    AIshoot = Math.random() < 0.003 * dt * (Math.exp(-angabs*10) + AIexcitement + q1);
  }
}

var musicPhase = 0;
var musicTick = 0;
var musicFreq = 0.3;
var musicPaused = 0;

function update () {
  var i;
  var nbSpaceshipBullets = 0;

  if (!dying && playingSince>0 && t-musicPaused>5000) {
    musicFreq *= 1 + 0.00003*dt;

    if (musicFreq > 2) {
      musicFreq = 0.3;
      musicPaused = t;
    }

    musicPhase += musicFreq*2*Math.PI*dt/1000;
    if ((Math.sin(musicPhase) > 0) !== musicTick) {
      musicTick = !musicTick;
      play(musicTick ? Amusic1 : Amusic2);
    }
  }

  // randomly send some asteroids
  if (Math.random() < 0.001 * dt)
    randomInGameAsteroid();

  // player lifecycle

  playingSince += dt;

  if (lifes == 0 && playingSince > 0) {
    // player enter
    resurrectionTime = t;
    lifes = 4;
    player ++;
    score = 0;
    scoreForLife = 0;
    asteroids = [];
    musicFreq = 0.3;
    musicPaused = t;
  }

  // inc lifecycle

  if (playingSince > 1000 && lifes) {
    for (i = 0; i < incomingObjects.length; i++) {
      var o = incomingObjects[i];
      if (!o[10]) {
        var p = incPosition(o);
        var matchingTap = tap && circleCollides(tap, p, 40 + 10 * o[6]);
        if (keys[o[7]] || matchingTap) {
          // send an asteroid
          nevedPlayed = tap = keys[o[7]] = 0;
          if (sendAsteroid(o))
            incomingObjects.splice(i--, 1);
          else
              o[10] = t;
        }
      }
      else {
        if (t-o[10] > 1000)
          incomingObjects.splice(i--, 1);
      }
    }
    tap = 0;

    while(maybeCreateInc());
  }

  // spaceship lifecycle

  if (dying && t-dying > 2000 + (lifes>1 ? 0 : 2000)) {
    dying = 0;
    spaceship = [ W/2, H/2, 0, 0, 0 ];
    if (--lifes) {
      resurrectionTime = t;
    }
    else {
      // Player lost. game over
      playingSince = -5000;
      randomAsteroids();
      play(Alost);
    }
  }

  // collision

  bullets.forEach(function (bull, i) {
    if (!bull[5]) nbSpaceshipBullets ++;
    var j;

    /*
    // bullet-spaceship collision
    if (!dying && bull[4]<270 && circleCollides(bull, spaceship, 20)) {
      explose(bull);
      bullets.splice(i, 1);
      spaceshipDie();
      return;
    }
    */

    /*
    for (j = 0; j < aliens.length; ++j) {
      var alien = aliens[j];
      if (circleCollides(bull, alien, 20)) {
        explose(bull);
        bullets.splice(i, 1);
        aliens.splice(j, 1);
        return;
      }
    }
    */

    for (j = 0; j < asteroids.length; ++j) {
      var aster = asteroids[j];
      var lvl = aster[5];
      // bullet-asteroid collision
      if (circleCollides(bull, aster, 10 * lvl)) {
        explose(bull);
        bullets.splice(i, 1);
        explodeAsteroid(j);
        var s = 20 * Math.floor(0.4 * (6 - lvl) * (6 - lvl));
        score += s;
        scoreForLife += s;
        if (scoreForLife > 10000) {
          lifes ++;
          scoreForLife = 0;
        }
        best = Math.max(best, score);
        return;
      }
    }
  });

  if (!dying && playingSince > 0) asteroids.forEach(function (aster, j) {
    // asteroid-spaceship collision
    if (circleCollides(aster, spaceship, 10 + 10 * aster[5])) {
      if (t - resurrectionTime < 1000) {
        // if spaceship just resurect, will explode the asteroid
        explodeAsteroid(j);
      }
      else {
        // otherwise, player die
        explose(spaceship);
        spaceshipDie();
      }
    }
  });

  // run spaceship AI
  AIexcitement = 0;
  if (!dying && playingSince > 0) {
    var ax = Math.cos(spaceship[4]);
    var ay = Math.sin(spaceship[4]);

    var quality =
      1-Math.exp((1-player)/4) +
      1-Math.exp((1-player)/8);
    var rep = Math.random();
    var mix = Math.exp((1-player)/16);
    rep = rep * mix + 0.5 * (1-mix);
    var q1 = Math.min(1, rep * quality);
    var q2 = quality - q1;

    // ai logic (determine the 3 inputs)
    aiLogic(q1, q2);

    // apply ai inputs with game logic

    spaceship[2] += AIboost * dt * 0.0002 * ax;
    spaceship[3] += AIboost * dt * 0.0002 * ay;
    spaceship[4] = normAngle(spaceship[4] + AIrotate * dt * 0.005);
    if (nbSpaceshipBullets < 4) {
      if (AIshoot) {
        play(Ashot);
        bullets.push([
          spaceship[0] + 14 * ax,
          spaceship[1] + 14 * ay,
          spaceship[2] + 0.3 * ax,
          spaceship[3] + 0.3 * ay,
          1000,
          0
        ]);
      }
    }
  }

  euclidPhysics(spaceship);
  asteroids.forEach(polarPhysics);
  //aliens.forEach(polarPhysics);
  bullets.forEach(euclidPhysics);
  particles.forEach(polarPhysics);

  incomingObjects.forEach(applyIncLogic);

  particles.forEach(applyLife);
  loopOutOfBox(spaceship);
  asteroids.forEach(playingSince > 0 ? destroyOutOfBox : loopOutOfBox);
  //aliens.forEach(loopOutOfBox);
  bullets.forEach(applyLife);
  bullets.forEach(loopOutOfBox);

  excitementSmoothed += 0.04 * (AIexcitement - excitementSmoothed);
}


function incPosition (o) {
  var i = o[0] % borderLength;
  var x, y;
  var w = W + GAME_INC_PADDING;
  var h = H + GAME_INC_PADDING;
  if (i<w) {
    x = i;
    y = 0;
  }
  else {
    i -= w;
    if (i < h) {
      x = w;
      y = i;
    }
    else {
      i -= h;
      if (i < w) {
        x = w - i;
        y = h;
      }
      else {
        i -= w;
        x = 0;
        y = h - i;
      }
    }
  }
  var p = [ -GAME_INC_PADDING/2 + x, -GAME_INC_PADDING/2 + y ];
  if (o[10]) {
    var dt = t - o[10];
    var a = Math.atan2(spaceship[1] - p[1], spaceship[0] - p[0]);
    var l = dt * 0.3;
    p[0] -= Math.cos(a) * l;
    p[1] -= Math.sin(a) * l;
  }
  return p;
}

function incRotationCenter (o) {
  var p = incPosition(o);
  var toCenter = Math.atan2(spaceship[1] - p[1], spaceship[0] - p[0]);
  return toCenter;
}

function incRotation (o) {
  return Math.cos(o[2]) * o[8] + incRotationCenter(o);
  //return o[2];
}

// Game DRAWING

function drawSpaceship (o) {
  ctx.strokeStyle = "#f00";
  ctx.globalAlpha = 0.4;
  ctx.rotate(o[4]);
  if (dying) {
    ctx.lineWidth = 2;
    var delta = (t-dying)/200;

    path([
      [-6, -6 - 0.5*delta],
      [3, -3 - 0.9*delta]
    ]);
    ctx.stroke();

    if (delta < 8) {
      path([
        [3 + 0.4*delta, -3 - 0.8*delta],
        [12 + 0.4*delta, 0 - 0.5*delta]
      ]);
      ctx.stroke();
    }

    path([
      [12, 0+0.4*delta],
      [3, 3+delta]
    ]);
    ctx.stroke();

    if (delta < 9) {
      path([
        [1, 5 + delta],
        [-6, 6 + delta]
      ]);
      ctx.stroke();
    }

    if (delta < 7) {
      path([
        [-6 - delta, -6],
        [-6 - delta, 6]
      ]);
      ctx.stroke();
    }
  }
  else {
    path([
      [-6, -6],
      [ 12, 0],
      [ -6, 6],
      [ -5, 0]
    ]);
    ctx.stroke();
  }
}

function drawAsteroid (o) {
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = "#f00";
  path(o[4]);
  ctx.stroke();
}

function drawBullet () {
  ctx.globalAlpha = 1 - Math.random()*Math.random();
  ctx.fillStyle = "#00f";
  ctx.beginPath();
  ctx.arc(0, 0, 2+2.5*Math.random(), 0, 2*Math.PI);
  ctx.fill();
}

function drawParticle () {
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = "#f00";
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, 2*Math.PI);
  ctx.fill();
}
function drawGameUI () {
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle = "#0f0";
  ctx.globalAlpha = 0.3;


  ctx.save();
  ctx.translate(W/2, 20);
  font(scoreTxt(best), .6);
  ctx.restore();

  ctx.save();
  ctx.translate(50, 20);
  font(scoreTxt(score), 1.5, 1);
  ctx.restore();

  if (playingSince < 0) {
    ctx.save();
    ctx.translate(W-50, 20);
    font(scoreTxt(0), 1.5, -1);
    ctx.restore();

    ctx.save();
    ctx.translate(W/2 - 160, 0.7*H);
    path([
      [0,2],
      [0,18]
    ]);
    ctx.stroke();
    ctx.translate(40,0);
    font("COIN", 2, 1);
    ctx.translate(40,0);
    path([
      [0,2],
      [0,18]
    ]);
    ctx.stroke();
    ctx.translate(40,0);
    font("PLAY", 2, 1);
    ctx.restore();
  }
  else {
    for (var i=1; i<lifes; i++) {
      ctx.save();
      ctx.translate(60 + i * 10, 50);
      ctx.rotate(-Math.PI/2);
      path([
        [-4, -4],
        [ 10, 0],
        [ -4, 4],
        [ -3, 0]
      ]);
      ctx.stroke();
      ctx.restore();
    }
  }
  if (dying && lifes==1) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.translate(W/2, 140);
    font("GAME OVER", 2);
    ctx.restore();
  }
  ctx.save();
  ctx.translate(W/2, H-14);
  font("2015 GREWEB INC", .6);
  ctx.restore();
  ctx.restore();
}

function drawGlitch () {
  ctx.save();
  ctx.fillStyle =
  ctx.strokeStyle = "#f00";
  ctx.globalAlpha = 0.03;
  ctx.translate(W/2, H/2);
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, 2*Math.PI);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, 2*Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 12, 4, 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 12, 1, 2);
  ctx.stroke();
  ctx.restore();
}

//// UI

function drawInc (o) {
  var rotC = incRotationCenter(o);
  var phase = Math.cos(o[2]);
  var rot = phase * o[8] + rotC;
  var w = 10 * o[6];
  var valid = Math.abs(phase) < o[9];

  if (playingSince>0 && lifes && !dying && !o[10]) {
    ctx.lineWidth = 1+o[3]/60;
    ctx.strokeStyle = valid ? "#7cf" : "#f66";

    if (o[8] > 0.1) {
      ctx.save();
      ctx.rotate(rotC);
      ctx.strokeStyle = "#f66";
      ctx.beginPath();
      ctx.arc(0, 0, w+10, -o[8], -o[8]*o[9]);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, w+10, o[8]*o[9], o[8]);
      ctx.stroke();
      ctx.strokeStyle = "#7cf";
      ctx.beginPath();
      ctx.arc(0, 0, w+10, -o[8] * o[9], o[8] * o[9]);
      ctx.stroke();
      path([
        [w+8, 0],
        [w+12, 0]
      ]);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.rotate(rot);
    ctx.save();
    var mx = 60 + w;
    var x = o[3] + w;
    ctx.globalAlpha = 0.2;
    path([
      [0,0],
      [mx,0]
    ]);
    ctx.stroke();
    ctx.restore();
    path([
      [0,0],
      [x,0]
    ]);
    ctx.stroke();
    var r = 6;
    path([
      [ mx - r, r ],
      [ mx, 0],
      [ mx - r, -r ]
    ], 1);
    ctx.stroke();
    ctx.restore();
  }
  else {
    ctx.strokeStyle = o[10] ? "#f66" : "#999";
  }

  ctx.save();
  path(o[5]);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  var sum = [0, 0];
  o[5].forEach(function (p) {
    sum[0] += p[0];
    sum[1] += p[1];
  });

  if (!MOBILE && playingSince>0) {
    ctx.save();
    ctx.translate(sum[0]/o[5].length+1, sum[1]/o[5].length-5);
    font(String.fromCharCode(o[7]), 1);
    ctx.restore();
  }
}

var lastStatement, lastStatementTime = 0;

function drawUI () {
  var currentMessage = "",
    currentMessage2 = "",
    currentMessageClr = "#f7c",
    currentMessageClr2 = "#7fc";

  if (!player) {
    if (playingSince<-7000) {
      currentMessage = "BEHIND ASTEROIDS";
      currentMessage2 = "THE DARK SIDE";
    }
    else if (playingSince<-3500) {
      currentMessageClr = currentMessageClr2 = "#7cf";
      currentMessage = "SEND ASTEROIDS TO MAKE";
      currentMessage2 = "PLAYERS WASTE THEIR MONEY";
    }
    else {
      var nb = Math.min(25, Math.floor((playingSince+3500)/80));
      for (var i=0; i<nb; i++)
        currentMessage += ".";
      if (playingSince>-2000)
        currentMessage2 = "A NEW PLAYER!";
    }
  }
  else if (dying) {
    if (lifes==1) {
      currentMessage = "GOOD JOB !!!";
      currentMessage2 = "THE DUDE IS BUMMED";
    }
    else if (lifes==2) {
      currentMessage = "OK...";
      currentMessage2 = "ONE MORE TIME !";
    }
    else {
      if (lastStatement && t - lastStatementTime > 3000) { // lastStatementTime is not used here
        currentMessage = lastStatement;
      }
      else {
        currentMessage = ["!!!", "GREAT!", "COOL!", "OMG!", "AHAH!", "RUDE!", "EPIC!", "WICKED!", "SHAME!", "HEHEHE!", "BWAHAHA!"];
        lastStatement = currentMessage = currentMessage[Math.floor(Math.random() * currentMessage.length)];
        lastStatementTime = 0;
      }
    }
  }
  else {
    if (playingSince<0) {
      currentMessage = "INCOMING NEW PLAYER...";
      currentMessage2 = "ONE MORE 25¢ COIN! AHAH!";
    }
    else if (playingSince<6000 && lifes==4) {
      currentMessage = "PLAYER "+player;
      currentMessage2 = [
        "GENIOUS PLAYER!!",
        "EXPERIENCED PLAYER!!",
        "GOOD PLAYER. GET READY",
        "NICE PLAYER.",
        "BEGINNER.",
        "VERY BEGINNER. EASY KILL"
      ][Math.floor(Math.exp((-player)/8)*6)];
    }
    else {
      currentMessageClr2 = "#f66";
      if (lastStatement && t - lastStatementTime < 3000) {
        currentMessage2 = lastStatement;
      }
      else {
        if (nevedPlayed) {
          if (playingSince>10000) {
            currentMessage = MOBILE ? "TAP ON ASTEROIDS" : "PRESS ASTEROIDS LETTER";
            currentMessage2 = "TO SEND THEM TO THE GAME";
          }
        }
        else {
          lastStatement = 0;
          if (Math.random() < 0.0001 * dt && t - lastStatementTime > 8000) {
            currentMessage2 = [
              "COME ON! KILL IT!",
              "JUST DO IT!",
              "I WANT ¢¢¢",
              "GIVE ME SOME ¢¢¢",
              "DO IT!",
              "DESTROY IT!"
            ];
            lastStatement = currentMessage2 = currentMessage2[Math.floor(Math.random() * currentMessage2.length)];
            lastStatementTime = t;
          }
        }
      }
    }
  }

  ctx.save();
  ctx.translate(FW - GAME_MARGIN, 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#7cf";
  font((player*25)+"¢", 2, -1);
  ctx.restore();

  ctx.save();
  ctx.translate(GAME_MARGIN, MOBILE ? 40 : 2);
  ctx.lineWidth = (t%600>300) ? 2 : 1;
  ctx.save();
  ctx.strokeStyle = currentMessageClr;
  font(currentMessage, MOBILE ? 1.5 : 2, 1);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = currentMessageClr2;
  ctx.translate(0, MOBILE ? 30 : 40);
  font(currentMessage2, MOBILE ? 1.5 : 2, 1);
  ctx.restore();
  ctx.restore();
}


function scoreTxt (s) {
  return (s<=9?"0":"")+s;
}

// Game Post Effects

// Main Code

function translateTo (p) {
  ctx.translate(p[0], p[1]);
}
function renderCollection (coll, draw) {
  for (var i=0; i<coll.length; ++i) {
    ctx.save();
    translateTo(coll[i]);
    draw(coll[i]);
    ctx.restore();
  }
}

var _lastT;
function render (_t) {
  requestAnimationFrame(render);
  if (!_lastT) _lastT = _t;
  dt = Math.min(100, _t-_lastT);
  _lastT = _t;

  checkSize();

  t += dt; // accumulate the game time (that is not the same as _t)

  // UPDATE game

  update();

  // RENDER game

  // UI Rendering

  ctx = uiCtx;

  ctx.save();

  ctx.scale(uiScale, uiScale);

  ctx.save();
  ctx.clearRect(0, 0, FW, FH);

  drawUI();

  ctx.translate(GAME_MARGIN, GAME_TOP_MARGIN);

  incomingObjects.forEach(function (inc) {
    ctx.save();
    translateTo(incPosition(inc));
    drawInc(inc);
    ctx.restore();
  });

  ctx.restore();

  ctx.restore();

  // Game rendering

  ctx = gameCtx;

  ctx.save();

  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  renderCollection(asteroids, drawAsteroid);
  //renderCollection(aliens, drawAlien);
  renderCollection(bullets, drawBullet);
  renderCollection(particles, drawParticle);

  if (playingSince > 0) {
    ctx.save();
    translateTo(spaceship);
    drawSpaceship(spaceship);
    ctx.restore();
  }

  drawGameUI();

  drawGlitch();

  ctx.restore();

  // WEBGL after effects

  glSetTexture(textureGame, g);

  // Laser
  glBindFBO(laserFbo);
  glBindShader(laserShader);
  gl.uniform1i(glUniformLocation(laserShader, "t"), glBindTexture(textureGame, 0));
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Player / env
  glBindFBO(playerFbo);
  glBindShader(playerShader);
  gl.uniform1f(glUniformLocation(playerShader, "pt"), playingSince / 1000);
  gl.uniform1f(glUniformLocation(playerShader, "pl"), player);
  gl.uniform1f(glUniformLocation(playerShader, "ex"), excitementSmoothed);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  glBindFBO(fbo1);
  glBindShader(blur1dShader);
  gl.uniform1i(glUniformLocation(blur1dShader, "t"), glBindTexture(glGetFBOTexture(playerFbo), 0));
  gl.uniform2f(glUniformLocation(blur1dShader, "dir"),  6, 0 );
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  glBindFBO(fbo2);
  glBindShader(blur1dShader);
  gl.uniform1i(glUniformLocation(blur1dShader, "t"), glBindTexture(glGetFBOTexture(fbo1), 0));
  gl.uniform2f(glUniformLocation(blur1dShader, "dir"),  0, 2 );
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  glBindFBO(fbo1);
  glBindShader(blur1dShader);
  gl.uniform1i(glUniformLocation(blur1dShader, "t"), glBindTexture(glGetFBOTexture(fbo2), 0));
  gl.uniform2f(glUniformLocation(blur1dShader, "dir"),  2, 1 );
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  glBindFBO(playerFbo);
  glBindShader(blur1dShader);
  gl.uniform1i(glUniformLocation(blur1dShader, "t"), glBindTexture(glGetFBOTexture(fbo1), 0));
  gl.uniform2f(glUniformLocation(blur1dShader, "dir"),  2, -1 );
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Glare
  glBindFBO(glareFbo);
  glBindShader(glareShader);
  gl.uniform1i(glUniformLocation(glareShader, "t"), glBindTexture(glGetFBOTexture(laserFbo), 0));
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  glBindFBO(fbo1);
  glBindShader(blur1dShader);
  gl.uniform1i(glUniformLocation(blur1dShader, "t"), glBindTexture(glGetFBOTexture(glareFbo), 0));
  gl.uniform2f(glUniformLocation(blur1dShader, "dir"),  1, -2 );
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  glBindFBO(fbo2);
  glBindShader(blur1dShader);
  gl.uniform1i(glUniformLocation(blur1dShader, "t"), glBindTexture(glGetFBOTexture(fbo1), 0));
  gl.uniform2f(glUniformLocation(blur1dShader, "dir"),  2, -4 );
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  glBindFBO(fbo1);
  glBindShader(blur1dShader);
  gl.uniform1i(glUniformLocation(blur1dShader, "t"), glBindTexture(glGetFBOTexture(fbo2), 0));
  gl.uniform2f(glUniformLocation(blur1dShader, "dir"),  2, -5 );
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  glBindFBO(glareFbo);
  glBindShader(blur1dShader);
  gl.uniform1i(glUniformLocation(blur1dShader, "t"), glBindTexture(glGetFBOTexture(fbo1), 0));
  gl.uniform2f(glUniformLocation(blur1dShader, "dir"),  2, -4 );
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Blur
  glBindFBO(fbo1);
  glBindShader(blur1dShader);
  gl.uniform1i(glUniformLocation(blur1dShader, "t"), glBindTexture(glGetFBOTexture(laserFbo), 0));
  gl.uniform2f(glUniformLocation(blur1dShader, "dir"),  1, 1 );
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  glBindFBO(fbo2);
  glBindShader(blur1dShader);
  gl.uniform1i(glUniformLocation(blur1dShader, "t"), glBindTexture(glGetFBOTexture(fbo1), 0));
  gl.uniform2f(glUniformLocation(blur1dShader, "dir"),  -1, 1 );
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  glBindFBO(fbo1);
  glBindShader(blur1dShader);
  gl.uniform1i(glUniformLocation(blur1dShader, "t"), glBindTexture(glGetFBOTexture(fbo2), 0));
  gl.uniform2f(glUniformLocation(blur1dShader, "dir"),  1.5, 0 );
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  glBindFBO(fbo2);
  glBindShader(blur1dShader);
  gl.uniform1i(glUniformLocation(blur1dShader, "t"), glBindTexture(glGetFBOTexture(fbo1), 0));
  gl.uniform2f(glUniformLocation(blur1dShader, "dir"),  0, 1.5 );
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Persistence
  glBindFBO(fbo1);
  glBindShader(persistenceShader);
  gl.uniform1i(glUniformLocation(persistenceShader, "t"), glBindTexture(glGetFBOTexture(fbo2), 0));
  gl.uniform1i(glUniformLocation(persistenceShader, "r"), glBindTexture(glGetFBOTexture(persistenceFbo), 1));
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  glBindFBO(persistenceFbo);
  glBindShader(copyShader);
  gl.uniform1i(glUniformLocation(copyShader, "t"), glBindTexture(glGetFBOTexture(fbo1), 0));
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Final draw
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  glBindShader(gameShader);
  gl.uniform1i(glUniformLocation(gameShader, "G"), glBindTexture(glGetFBOTexture(laserFbo), 0));
  gl.uniform1i(glUniformLocation(gameShader, "R"), glBindTexture(glGetFBOTexture(persistenceFbo), 1));
  gl.uniform1i(glUniformLocation(gameShader, "B"), glBindTexture(glGetFBOTexture(fbo2), 2));
  gl.uniform1i(glUniformLocation(gameShader, "L"), glBindTexture(glGetFBOTexture(glareFbo), 3));
  gl.uniform1i(glUniformLocation(gameShader, "E"), glBindTexture(glGetFBOTexture(playerFbo), 4));
  gl.uniform1f(glUniformLocation(gameShader, "s"), !player ? smoothstep(-4000, -3000, playingSince) : 1);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

requestAnimationFrame(render);



if (DEBUG) {
  playingSince=-1;
  addEventListener("click", function () {
    playingSince = -1;
    player += 1;
    incomingObjects = [];
    console.log("player=", player);
  });

  /*
  setInterval(function () {
    createInc();
    if (incomingObjects[0]) sendAsteroid(incomingObjects[0]);
    incomingObjects.splice(0, 1);
  }, 1000);
  */

}
