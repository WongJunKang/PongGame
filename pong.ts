
import { interval, fromEvent, from, zip, timer, Subscription } from 'rxjs'
import { map, scan, filter, flatMap, take, concat, merge, max} from 'rxjs/operators'


const
  Constants = new class {
    readonly CanvasWidth = 900;
    readonly CanvasHeight = 600;
    readonly BallRadius = 5;
    readonly PaddleWidth = 10;
    readonly PaddleHeight = 80;
    readonly BallXVelocity = 3;
    readonly BallYVelocity = -4;
    readonly MinBallYVelocity = 3;
    readonly MaxBallYVelocity = 7;
    readonly PaddleVelocity = 4;
    readonly PlayerPaddleVelocity = 6;
    readonly TopBoundary = 100;
    readonly LeftBoundary = 100;
    readonly RightBoundary = this.CanvasWidth - 100;
    readonly MaxScore = 7;
    readonly StartTime = 0;
    readonly BallSpawnDelay = 200;
    readonly ScaleFactor = 20;
    readonly PlayerPaddleXPos = 750;
    readonly PaddleYPos = 300;
    readonly PaddleXPos = 150;
    readonly BallYPos = 350;
    readonly TunePaddle = 5;
  }

/*
Declared types
*/
type Key = 'ArrowUp' | 'ArrowDown'| 'Enter'
type Event = 'keydown' | 'keyup' | 'mouseover' | 'mouseout'
type id = 'paddle' | 'playerpaddle' | 'ball'

/*
The Pong game
*/
function pong() {
  // Inside this function you will use the classes and functions 
  // from rx.js
  // to add visuals to the svg element in pong.html, animate them, and make them interactive.
  // Study and complete the tasks in observable exampels first to get ideas.
  // Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/ 
  // You will be marked on your functional programming style
  // as well as the functionality that you implement.
  // Document your code! 

  
  //The all the classes used in Pong game
  

  /*
  This function is in charge of all the view updates/ sync data with view
  (referenced from: https://stackblitz.com/edit/asteroids05?file=index.ts )
  */
 class Vec {
  constructor(public readonly x: number = 0, public readonly y: number = 0) {}
  add = (b:Vec) => new Vec(this.x + b.x, this.y + b.y)
  sub = (b:Vec) => this.add(b.scale(-1))
  len = ()=> Math.sqrt(this.x*this.x + this.y*this.y)
  scale = (s:number) => new Vec(this.x*s,this.y*s)
  ortho = ()=> new Vec(this.y,-this.x)
  rotate = (deg:number) =>
            (rad =>(
                (cos,sin,{x,y})=>new Vec(x*cos - y*sin, x*sin + y*cos)
              )(Math.cos(rad), Math.sin(rad), this)
            )(Math.PI * deg / 180)

  static unitVecInDirection = (deg: number) => new Vec(0,-1).rotate(deg)
  static Zero = new Vec();
}
  class Translate { constructor(public readonly velocity:Vec) {} }
  class Tick { constructor(public readonly elapsed:number) {} }
  class RestartGame { constructor() {} }
  class MouseOnCanvas { constructor(public readonly onCanvas:boolean) {} }


  /*
  Handle keyboard events with observables
  */
  const keyObservable$ = <T>(e:Event, k:Key, result:()=>T)=>
    fromEvent<KeyboardEvent>(document,e)
        .pipe(
          filter(({code})=>code === k),
          filter(({repeat})=>!repeat),
          map(result)),
    paddleUp$ = keyObservable$('keydown','ArrowUp', ()=>new Translate(new Vec(0, -Constants.PlayerPaddleVelocity))),
    stopUp$ = keyObservable$('keyup','ArrowUp', ()=>new Translate(Vec.Zero)),
    paddleDown$ = keyObservable$('keydown','ArrowDown',()=>new Translate(new Vec(0, Constants.PlayerPaddleVelocity))),
    stopDown$ = keyObservable$('keyup','ArrowDown',()=>new Translate(Vec.Zero)),
    restart$ = keyObservable$('keydown', 'Enter', ()=> new RestartGame()),
    
    // get canvas to detect mouse event
    canvas = document.getElementById('canvas'),

    /*
    Handle keyboard events using observables
    */
    mousePosObservable$  = <T> (e:Event, result:() => T) =>
        fromEvent<MouseEvent>(canvas, e).pipe(map(result)),

    mouseOnCanvas$ = mousePosObservable$('mouseover', () => new MouseOnCanvas(true)),
    mouseLeftCanvas$ = mousePosObservable$('mouseout',  () => new MouseOnCanvas(false)),

    
    /*
    This function check if an object's y is out of Top bound or Lower bound
    */
    outOfBound = ({x, y}: Vec, b: Body) => {
      const 
        h = Constants.CanvasHeight,
        halt = (v:number) => v < Constants.TopBoundary ? Constants.TopBoundary : v > h - b.height ? h - b.height: v
      return new Vec(x, halt(y)) 
    },
    /*
    this function checks if an interval overlapped
    */
    overlapped = (ps:number , pe: number, bs: number, be: number) => !(be < ps  || bs > pe)

  /*
  This function acts as the building block of all object in Pong and defines their property types
  */
  type Body = Readonly<{
    id:id,
    width:number,
    height: number,
    pos: Vec,
    vel: Vec,
    acc: Vec, // allow for furture extensibility
    createTime: number,
    paused: boolean
  }>
  /*
  this function checks if an interval overlapped
  */
  type State = Readonly<{
    paddle: Body,
    playerpaddle: Body,
    ball: Body,
    nonPlayerScore: number,
    playerScore: number, 
    gameOver:boolean,
    time: number,
    onCanvas: boolean
  }>
  const
    /*
    This function creates player and non-player paddle
    */
    createPaddle = (objid:id) => (pos:Vec) => (vel: Vec)=> (halt:boolean) =>
    <Body>{
      id: objid,
      width: Constants.PaddleWidth,
      height: Constants.PaddleHeight,
      pos:pos,
      vel: vel,
      acc: Vec.Zero,
      createTime: 0,
      paused:halt
    },
    /*
    This function creates ball.
    */
    createBall = (ballVelocity:Vec) => (position: Vec) => (time: number)=> 
    <Body> {
      id:'ball',
      width: Constants.BallRadius,
      height: Constants.BallRadius,
      pos: position,
      vel: ballVelocity,
      acc: Vec.Zero,
      createTime: time,
      paused: false
    },
    /*
    This function defines the initial state when the game first started.
    */
    initialState:State = {
      paddle: createPaddle('paddle')(new Vec(Constants.PaddleXPos, Constants.PaddleYPos))(Vec.Zero)(false),
      playerpaddle: createPaddle('playerpaddle')(new Vec(Constants.PlayerPaddleXPos, Constants.PaddleYPos))(Vec.Zero)(true),
      ball: createBall(new Vec(Constants.BallXVelocity, Constants.BallYVelocity))(new Vec(Constants.CanvasWidth/2, Constants.BallYPos))(Constants.StartTime),
      nonPlayerScore: 0,
      playerScore:0,
      gameOver: false,
      time: 0,
      onCanvas: false
    },
    /*
    This function is in charge of all movement of object, including pausing and increasing x/y position.
    */
    moveObj = (o:Body) => <Body>{
      ...o,
       // handles out of bound for objects (i.e. paddle)
      pos: o.paused ? o.pos : outOfBound(o.pos.add(o.vel), o),
      vel: o.vel.add(o.acc), 
      acc: Vec.Zero
    },
    /*
    This function makes non player's paddle to follow the ball
    */
    followBallAction = (s:State) => {
      const
      // get centre of ball and paddle
        by = s.ball.pos.y + (s.ball.height/2), 
        py = s.paddle.pos.y + (s.paddle.height/2),

        // calVelocity = py > by ? // go up : // smaller : go down : // stay
        calVelocity = py - by > Constants.TunePaddle ? new Vec(0, -Constants.PaddleVelocity) : by - py > Constants.TunePaddle  ? new Vec(0, Constants.PaddleVelocity) : Vec.Zero,
        newPaddle = createPaddle("paddle")(s.paddle.pos)(calVelocity)(false)
      return <State>{
        ...s,
        paddle: newPaddle
      }
    },
    /*
    This function pauses all objects, when the game is over.
    */
    gameOver = (s:State) =>{
         return s.gameOver? { ...s,
            playerpaddle :{...s.playerpaddle, paused: true},
            paddle :{...s.paddle, paused: true},
            ball :{...s.ball, paused: true},
      }:s
    },
    /*
    This function deals with all collision logic.
    */
    collisionLogic = (s:State) => {
      const
        // determine overlap for ball and paddle
        objOverlapped = (a:Body, b:Body) => overlapped(a.pos.y, a.pos.y + a.height , b.pos.y, b.pos.y + b.height), 
        bodiesCollided = (a:Body, b:Body) =>  a.pos.x == b.pos.x && objOverlapped(a, b),
        
        // use for y velocity scaling, changing y's magnitude according to which part of the paddle the ball strikes
        calYVelocity = (p:Body) => 
          {const
              paddlepos = p.pos.y + (p.height/2),
              ballpos = s.ball.pos.y + (s.ball.height/ 2),
              distanceFromCentre = Math.abs(paddlepos - ballpos),

              // distanceFromCentre ranges from 0 - 45 / p.height = 80/8 = 10, hit centre, ball gets slower, hits side ball becomes faster
              // more chances for increasing velocity than decreasing velocity.
              // determine magnitude
              scale = 1 + ((distanceFromCentre - p.height/8)/Constants.ScaleFactor),
              newYVel = Math.abs(s.ball.vel.y) * scale,

              // if exceeded lowest possible y, set to min Y, if exceeded higest possible y, set to max x, to prevent ball from going too fast/ too slow.
              ret = newYVel < Constants.MinBallYVelocity ? Constants.MinBallYVelocity : newYVel > Constants.MaxBallYVelocity ? Constants.MaxBallYVelocity : newYVel,

              // calculate change of direction
              dir  = paddlepos > ballpos ? -1 : 1
              return ret * dir
            },
          
        ballPaddleCollided = bodiesCollided(s.paddle, s.ball),
        ballPlayerPaddleCollided = bodiesCollided(s.playerpaddle, s.ball),


        ballWallCollided = s.ball.pos.y + s.ball.height + s.ball.vel.y > Constants.CanvasHeight || s.ball.pos.y + s.ball.vel.y <  Constants.TopBoundary,

        // create new vector depending on current state of ball
        newVec = 
        ballPaddleCollided ? new Vec(-s.ball.vel.x, calYVelocity(s.paddle))                 // ball collide paddle
        : ballPlayerPaddleCollided ? new Vec(-s.ball.vel.x, calYVelocity(s.playerpaddle))   // ball collide player paddle
        : ballWallCollided ? new Vec(s.ball.vel.x, -s.ball.vel.y): s.ball.vel,              // ball collide wall

        // set original create time back to current ball
        updateBall = createBall(newVec)(s.ball.pos)(s.ball.createTime), 
        

        collideRight = s.ball.pos.x > Constants.RightBoundary, 
        collideLeft = s.ball.pos.x < Constants.LeftBoundary,

        // Update score
        updatePlayerScore = collideLeft ? s.playerScore + 1: s.playerScore,
        updateNonPlayerScore = collideRight ? s.nonPlayerScore + 1: s.nonPlayerScore,

        // random spawn ball position and direction
        randomYPositon = Math.floor((Math.random() * 300) +  200),
        randomYVelocity = Math.random() * (Constants.MaxBallYVelocity - Constants.MinBallYVelocity)+ Constants.MinBallYVelocity,
        randomYDir = Math.random() < 0.5 ? -1 : 1,


        // if collide side walls, create new ball, else update ball as usual
        newBall = collideRight || collideLeft ?  
        createBall(new Vec(Constants.BallXVelocity, randomYVelocity*randomYDir))(new Vec(Constants.CanvasWidth/2, randomYPositon))(s.time)
        : updateBall,


        reachMaxScore = updatePlayerScore == Constants.MaxScore || updateNonPlayerScore == Constants.MaxScore             // check either player or non player reaches max score
      return <State> gameOver(followBallAction({
        ...s,
        ball: newBall,
        nonPlayerScore: updateNonPlayerScore,
        playerScore:updatePlayerScore,
        gameOver: reachMaxScore // gameOver, if 1 of the player or non player reaches max score.
      }))
    },
    /*
    This function deals with time logic, and allow the game to "experience" time/ to proceed forward.
    */
    tick = (s:State, elapsed:number) => {
      const
        // delay newball spawn
        isNewBall = (elapsed - s.ball.createTime) < Constants.BallSpawnDelay,
        setBall = isNewBall ? s.ball : moveObj(s.ball)

      return collisionLogic({...s,
        playerpaddle:moveObj(s.playerpaddle),
        paddle:moveObj(s.paddle),
        ball: setBall,
        time:elapsed
      })
    },
    /*
    This function return a state, depending on the event triggered, i.e. MouseOnCanvas, Translate or RestartGame.
    */
    reduceState = (s:State, e:Translate | RestartGame | Tick) =>
      e instanceof MouseOnCanvas ? { ...s,
        onCanvas : e.onCanvas, 
        playerpaddle :{...s.playerpaddle, paused: s.onCanvas},
      }:
      e instanceof Translate ? { ...s,
        playerpaddle:{...s.playerpaddle, vel:e.velocity}
      }:
      e instanceof RestartGame ?
      s.gameOver ? initialState : {// set game back to initial state
        ...s
      }
      :
      tick(s, e.elapsed),
    /*
    This function subscribes to observables.
    */
    subscription = interval(10).pipe(
    map(elapsed => new Tick(elapsed)),
    merge(mouseOnCanvas$, mouseLeftCanvas$),
    merge(paddleUp$,paddleDown$, stopUp$, stopDown$),
    merge(restart$),
    scan(reduceState, initialState)
    ).subscribe(syncView)
  /*
  This function is in charge of all the view updates/ sync data with view
  */
  function syncView(s: State){
    const
      playerpaddle = document.getElementById("playerpaddle")!,
      ball = document.getElementById("ball")!,
      paddle = document.getElementById("paddle")!,
      playerScore = document.getElementById("playerscore")!,
      nonPlayerScore = document.getElementById("nonplayerscore")!,
      
      // show/unhide HTML element only if conditions are met (referenced from: https://stackblitz.com/edit/asteroids05?file=index.ts )
      show = (id:string,condition:boolean)=>((e:HTMLElement) => 
      condition ? e.classList.remove('hidden')
                : e.classList.add('hidden'))(document.getElementById(id)!),

      // using this allow for future extension.
     //(referenced from: https://stackblitz.com/edit/asteroids05?file=index.ts )
      attr = (e:Element, o:any) =>
      {for(const k in o) e.setAttribute(k, String(o[k]))}  // for transformation

    attr(paddle, {transform : `translate(${s.paddle.pos.x},${s.paddle.pos.y})`})
    attr(playerpaddle, {transform : `translate(${s.playerpaddle.pos.x},${s.playerpaddle.pos.y})`})
    attr(ball, {transform : `translate(${s.ball.pos.x},${s.ball.pos.y})`})

    
    playerScore.textContent = String(s.playerScore)
    nonPlayerScore.textContent = String(s.nonPlayerScore)

    // show gameover and restart message
    show("gameover", s.gameOver)
    show("restart", s.gameOver)

    // Computer wins
    show("computerwins", s.nonPlayerScore === Constants.MaxScore)
    show("playerloses", s.nonPlayerScore === Constants.MaxScore)
    
    // Player Wins
    show("playerwins", s.playerScore === Constants.MaxScore)
    show("computerloses", s.playerScore === Constants.MaxScore)

  }
}

  // the following simply runs your pong function on window load.  Make sure to leave it in place.
  if (typeof window != 'undefined')
    window.onload = ()=>{
      pong();
  }