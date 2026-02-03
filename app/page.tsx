'use client'

import { useEffect, useRef, useState } from 'react'
import Matter from 'matter-js'
import { Play, RefreshCw } from 'lucide-react'

type GameMode = 'cup' | 'spike'

export default function KendamaGame() {
  const sceneRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Matter.Engine | null>(null)
  const ballRef = useRef<Matter.Body | null>(null)
  const targetRef = useRef<Matter.Body | null>(null)
  const handleRef = useRef<Matter.Body | null>(null)

  const [score, setScore] = useState(0)
  const [mode, setMode] = useState<GameMode>('cup')
  const [gameState, setGameState] = useState<'start' | 'playing' | 'success'>('start')
  const [debugInfo, setDebugInfo] = useState('')

  useEffect(() => {
    if (!sceneRef.current) return

    const { Engine, Render, World, Bodies, Constraint, Mouse, MouseConstraint, Runner, Events, Vector } = Matter

    const engine = Engine.create()
    engineRef.current = engine
    engine.world.gravity.y = 1.8 // 重力強め

    sceneRef.current.innerHTML = ''
    const render = Render.create({
      element: sceneRef.current,
      engine: engine,
      options: {
        width: window.innerWidth,
        height: window.innerHeight,
        wireframes: false,
        background: '#f0f9ff',
        pixelRatio: window.devicePixelRatio
      }
    })

    const centerX = window.innerWidth / 2
    const bottomY = window.innerHeight

    // --- 物体作成 ---

    // 1. 持ち手
    const handle = Bodies.rectangle(centerX, bottomY - 100, 30, 200, {
      isStatic: true,
      render: { fillStyle: '#8B4513' }
    })
    handleRef.current = handle

    // 2. ターゲット
    let targetBody: Matter.Body
    if (mode === 'cup') {
      const base = Bodies.rectangle(centerX, bottomY - 210, 100, 20, {
        isStatic: true,
        label: 'cup_target',
        render: { fillStyle: '#A0522D' }
      })
      const left = Bodies.rectangle(centerX - 55, bottomY - 230, 10, 60, { isStatic: true, render: { visible: false } })
      const right = Bodies.rectangle(centerX + 55, bottomY - 230, 10, 60, { isStatic: true, render: { visible: false } })
      targetBody = Matter.Body.create({ parts: [base, left, right], isStatic: true })
    } else {
      targetBody = Bodies.rectangle(centerX, bottomY - 250, 15, 150, {
        isStatic: true,
        label: 'spike_target',
        render: { fillStyle: '#CD853F' }
      })
    }
    targetRef.current = targetBody

    // 3. 玉
    const ball = Bodies.circle(centerX, bottomY - 400, 35, {
      restitution: 0.4,
      friction: 0.05,
      density: 0.04,
      label: 'ball',
      render: { fillStyle: '#DC143C' }
    })
    ballRef.current = ball

    // 4. 紐 (物理用)
    const stringLength = 320
    const stringAnchorOffset = { x: 0, y: -80 } // 持ち手のどこから紐が出るか
    
    const string = Constraint.create({
      label: 'string',
      bodyA: handle,
      bodyB: ball,
      pointA: stringAnchorOffset,
      length: stringLength,
      stiffness: 0.001,
      // ★物理演算上の紐は「透明」にする（Canvasで手描きするため）
      render: { visible: false } 
    })

    // 壁
    const wallOpts = { isStatic: true, render: { visible: false } }
    World.add(engine.world, [
      handle, targetBody, ball, string,
      Bodies.rectangle(centerX, -800, window.innerWidth * 2, 50, wallOpts), // 天井高く
      Bodies.rectangle(-100, window.innerHeight / 2, 50, window.innerHeight * 2, wallOpts),
      Bodies.rectangle(window.innerWidth + 100, window.innerHeight / 2, 50, window.innerHeight * 2, wallOpts),
      Bodies.rectangle(centerX, window.innerHeight + 100, window.innerWidth * 2, 50, wallOpts)
    ])

    // マウス
    const mouse = Mouse.create(render.canvas)
    const mouseConstraint = MouseConstraint.create(engine, {
      mouse: mouse,
      constraint: { stiffness: 0.2, render: { visible: false } }
    })
    World.add(engine.world, mouseConstraint)

    Render.run(render)
    const runner = Runner.create()
    Runner.run(runner, engine)

    // --- ① 紐の物理制御 (たるみ処理) ---
    Events.on(engine, 'beforeUpdate', () => {
      const anchorPos = Vector.add(handle.position, stringAnchorOffset)
      const dist = Vector.magnitude(Vector.sub(ball.position, anchorPos))

      // 距離が紐の長さより短ければ、力を抜く（たるむ）
      if (dist < stringLength - 5) {
        string.stiffness = 0.002
      } else {
        string.stiffness = 1 // 伸びきったら硬くする
      }
    })

    // --- ② 紐の「見た目」描画 (ここが重要！) ---
    Events.on(render, 'afterRender', () => {
      const ctx = render.context
      const anchorPos = Vector.add(handle.position, stringAnchorOffset)
      const ballPos = ball.position
      const dist = Vector.magnitude(Vector.sub(ballPos, anchorPos))

      ctx.beginPath()
      ctx.lineWidth = 4
      ctx.strokeStyle = '#666'
      ctx.lineCap = 'round'

      if (dist < stringLength - 10) {
        // たるんでいる時：ベジェ曲線を描く
        const midX = (anchorPos.x + ballPos.x) / 2
        const midY = (anchorPos.y + ballPos.y) / 2
        
        // たるみ具合（距離が近いほど深く垂れ下がる）
        const sag = (stringLength - dist) * 0.6
        
        ctx.moveTo(anchorPos.x, anchorPos.y)
        // 制御点を下にずらすことで「Ｕ字」のたるみを表現
        ctx.quadraticCurveTo(midX, midY + sag, ballPos.x, ballPos.y)
      } else {
        // 伸びきっている時：直線を描く
        ctx.moveTo(anchorPos.x, anchorPos.y)
        ctx.lineTo(ballPos.x, ballPos.y)
      }
      ctx.stroke()
    })

    return () => {
      Render.stop(render)
      Runner.stop(runner)
      World.clear(engine.world, false)
      Engine.clear(engine)
    }
  }, [mode])

  // --- 判定ループ ---
  useEffect(() => {
    const interval = setInterval(() => {
      if (!ballRef.current || !targetRef.current) return
      const ball = ballRef.current
      const target = targetRef.current
      const speed = Math.sqrt(ball.velocity.x ** 2 + ball.velocity.y ** 2)

      if (mode === 'cup') {
        const dx = Math.abs(ball.position.x - target.position.x)
        const dy = ball.position.y - (target.position.y - 40)
        if (dx < 40 && Math.abs(dy) < 30 && speed < 3) handleSuccess(ball)
      } else {
        const dx = Math.abs(ball.position.x - target.position.x)
        const dy = Math.abs(ball.position.y - (target.position.y - 75))
        if (dx < 25 && dy < 35 && speed < 8) handleSuccess(ball, true)
      }

      if (gameState === 'success' && speed > 5) setGameState('playing')
    }, 50)
    return () => clearInterval(interval)
  }, [mode, gameState])

  const handleSuccess = (ball: Matter.Body, magnet = false) => {
    if (gameState === 'success') return
    setScore(s => s + (mode === 'spike' ? 100 : 10))
    setGameState('success')
    if (navigator.vibrate) navigator.vibrate(50)

    if (magnet && engineRef.current && targetRef.current) {
       const constraint = Matter.Constraint.create({
         bodyA: targetRef.current,
         bodyB: ball,
         pointA: { x: 0, y: -75 },
         stiffness: 0.5,
         length: 0,
         render: { visible: false }
       })
       Matter.World.add(engineRef.current.world, constraint)
       setTimeout(() => Matter.World.remove(engineRef.current!.world, constraint), 1000)
    }
  }

  // --- センサー処理 (強力ジャンプ版) ---
  const requestPermission = async () => {
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      try {
        const res = await (DeviceMotionEvent as any).requestPermission()
        if (res === 'granted') startSensor()
      } catch (e) { console.error(e) }
    } else {
      startSensor()
    }
  }

  const startSensor = () => {
    setGameState('playing')
    window.addEventListener('devicemotion', (e) => {
       if (!engineRef.current || !ballRef.current) return
       
       const x = e.accelerationIncludingGravity?.x || 0
       engineRef.current.world.gravity.x = -x * 0.3

       // クイッ判定（感度調整済み）
       const accelY = e.acceleration?.y || 0
       const accelZ = e.acceleration?.z || 0

       if (accelY > 3 || accelZ > 3) { 
          // 速度を直接上書きして強制的に打ち上げる！
          Matter.Body.setVelocity(ballRef.current, { 
            x: ballRef.current.velocity.x, 
            y: -22 // この数値で「飛び上がり力」を調整
          })
          setDebugInfo('🚀 JUMP!')
       } else {
          setDebugInfo(`Y:${accelY.toFixed(1)}`)
       }
    })
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-100 touch-none select-none">
      <div ref={sceneRef} className="absolute inset-0" />

      {/* UI */}
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <button onClick={() => setMode('cup')} className={`px-4 py-2 rounded-full font-bold shadow ${mode === 'cup' ? 'bg-red-600 text-white' : 'bg-white'}`}>大皿</button>
        <button onClick={() => setMode('spike')} className={`px-4 py-2 rounded-full font-bold shadow ${mode === 'spike' ? 'bg-orange-500 text-white' : 'bg-white'}`}>剣先</button>
      </div>

      <div className="absolute top-6 left-6 z-10 bg-white/80 px-4 py-2 rounded-xl shadow">
        <span className="text-xs font-bold text-gray-500 block">SCORE</span>
        <span className="text-3xl font-black text-gray-800">{score}</span>
      </div>

      {gameState === 'start' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <h1 className="text-white text-5xl font-bold mb-8">KENDAMA</h1>
          <button onClick={requestPermission} className="bg-red-600 text-white px-10 py-5 rounded-full font-bold text-2xl shadow-xl hover:scale-105 transition flex items-center gap-2">
            <Play fill="currentColor" /> PLAY
          </button>
        </div>
      )}

      {gameState === 'success' && (
        <div className="absolute top-1/3 w-full text-center pointer-events-none animate-bounce">
           <span className="text-6xl font-black text-red-500 drop-shadow-xl stroke-white">{mode === 'spike' ? 'SPIKE!!' : 'GREAT!'}</span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 text-xs text-gray-400 font-mono">{debugInfo}</div>
    </div>
  )
}