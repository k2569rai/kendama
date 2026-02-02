'use client'

import { useEffect, useRef, useState } from 'react'
import Matter from 'matter-js'
import { Play, RotateCw } from 'lucide-react'

type GameMode = 'cup' | 'spike'

export default function KendamaGame() {
  const sceneRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Matter.Engine | null>(null)
  const ballRef = useRef<Matter.Body | null>(null)
  const targetRef = useRef<Matter.Body | null>(null)

  const [score, setScore] = useState(0)
  const [mode, setMode] = useState<GameMode>('cup')
  const [gameState, setGameState] = useState<'start' | 'playing' | 'success'>('start')
  const [debugInfo, setDebugInfo] = useState('')

  // 物理エンジンのセットアップ
  useEffect(() => {
    if (!sceneRef.current) return

    const { Engine, Render, World, Bodies, Constraint, Mouse, MouseConstraint, Runner } = Matter

    const engine = Engine.create()
    engineRef.current = engine
    // 重力を少し強めにして、リアルな落下感を出す
    engine.world.gravity.y = 1.8 

    // レンダラー設定
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

    // 2. ターゲット（大皿または剣先）
    let targetBody: Matter.Body
    if (mode === 'cup') {
      const base = Bodies.rectangle(centerX, bottomY - 210, 100, 20, {
        isStatic: true,
        label: 'cup_target',
        render: { fillStyle: '#A0522D' }
      })
      // こぼれ防止の壁（透明）
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
      restitution: 0.4, // 跳ね返りすぎないように調整
      friction: 0.05,
      density: 0.04,
      label: 'ball',
      render: { fillStyle: '#DC143C' }
    })
    ballRef.current = ball

    // 4. 紐 (重要設定！)
    const stringLength = 300
    const string = Constraint.create({
      label: 'string', // ★このラベルで後から探します
      bodyA: handle,
      bodyB: ball,
      pointA: { x: 0, y: -80 }, // 持ち手の先端から
      length: stringLength,
      stiffness: 0.001, // ★初期状態はダルダルにしておく
      render: {
        visible: true,
        strokeStyle: '#888',
        lineWidth: 3,
        type: 'line' // バネのギザギザではなく、ただの線にする
      }
    })

    // 5. 壁
    const wallOpts = { isStatic: true, render: { visible: false } }
    World.add(engine.world, [
      handle, targetBody, ball, string,
      Bodies.rectangle(centerX, -500, window.innerWidth * 2, 50, wallOpts), // 天井高く
      Bodies.rectangle(-50, window.innerHeight / 2, 50, window.innerHeight * 2, wallOpts),
      Bodies.rectangle(window.innerWidth + 50, window.innerHeight / 2, 50, window.innerHeight * 2, wallOpts),
      Bodies.rectangle(centerX, window.innerHeight + 100, window.innerWidth * 2, 50, wallOpts)
    ])

    // マウス操作（PC用）
    const mouse = Mouse.create(render.canvas)
    const mouseConstraint = MouseConstraint.create(engine, {
      mouse: mouse,
      constraint: { stiffness: 0.2, render: { visible: false } }
    })
    World.add(engine.world, mouseConstraint)

    Render.run(render)
    const runner = Runner.create()
    Runner.run(runner, engine)

    // ★★★ 紐のたるみ処理 & ゲーム判定ループ ★★★
    // 物理演算の更新ごとに実行されるイベント
    Matter.Events.on(engine, 'beforeUpdate', () => {
      if (!ball || !handle) return

      // 1. 紐の制御（これがリアルさの命！）
      // 持ち手の紐の付け根座標
      const anchorX = handle.position.x
      const anchorY = handle.position.y - 80 
      
      // 玉までの距離
      const dist = Math.sqrt((ball.position.x - anchorX)**2 + (ball.position.y - anchorY)**2)

      // 距離が紐の長さより短い = たるんでいる
      if (dist < stringLength) {
        string.stiffness = 0.002 // ほぼ力をゼロにする（自由落下）
        string.render.strokeStyle = '#ddd' // たるんでる演出（薄い色）
      } else {
        // 伸びきった = 引っ張る
        string.stiffness = 1 // ガツンと硬くする
        string.render.strokeStyle = '#555' // ピンと張った色
      }
    })

    return () => {
      Render.stop(render)
      Runner.stop(runner)
      World.clear(engine.world, false)
      Engine.clear(engine)
    }
  }, [mode])

  // --- 判定ループ（成功判定など） ---
  useEffect(() => {
    const interval = setInterval(() => {
      if (!ballRef.current || !targetRef.current) return

      const ball = ballRef.current
      const target = targetRef.current
      const speed = Math.sqrt(ball.velocity.x ** 2 + ball.velocity.y ** 2)

      if (mode === 'cup') {
        const dx = Math.abs(ball.position.x - target.position.x)
        const dy = ball.position.y - (target.position.y - 40)
        // 大皿判定
        if (dx < 40 && Math.abs(dy) < 30 && speed < 2) handleSuccess(ball)
      } else {
        const dx = Math.abs(ball.position.x - target.position.x)
        const dy = Math.abs(ball.position.y - (target.position.y - 75))
        // 剣先（マグネット判定）
        if (dx < 20 && dy < 30 && speed < 8) handleSuccess(ball, true)
      }

      // 復帰処理
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

  // --- センサー処理 ---
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
       
       // 重力コントロール（これは今のままでOK）
       const x = e.accelerationIncludingGravity?.x || 0
       const y = e.accelerationIncludingGravity?.y || 0
       engineRef.current.world.gravity.x = -x * 0.3
       
       // ★★★ ここから修正版ジャンプ処理 ★★★
       
       // 1. センサーの値を取る（nullチェック付き）
       const accelY = e.acceleration?.y || 0
       const accelZ = e.acceleration?.z || 0 

       // 2. 「クイッ」の判定（Y軸 または Z軸）
       // 少し緩めの「3」に設定（反応しすぎなら 5 に戻してください）
       if (accelY > 3 || accelZ > 3) { 
          
          // 3. 強制的に速度を与える（これが一番確実！）
          // 今の横方向の動きはそのままに、縦方向(y)だけ「-15」の速度で打ち上げる
          Matter.Body.setVelocity(ballRef.current, { 
            x: ballRef.current.velocity.x, 
            y: -20 // 数字が大きいほど高く飛びます（-15 〜 -25くらいがおすすめ）
          })
          
          setDebugInfo('🚀 LAUNCH!!')
       } else {
          // 普段は数値を表示
          setDebugInfo(`Y:${accelY.toFixed(1)} Z:${accelZ.toFixed(1)}`)
       }
    })
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-100 touch-none select-none">
      <div ref={sceneRef} className="absolute inset-0" />

      {/* UI: モード切替 */}
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <button onClick={() => setMode('cup')} className={`px-4 py-2 rounded-full font-bold shadow ${mode === 'cup' ? 'bg-red-600 text-white' : 'bg-white'}`}>大皿</button>
        <button onClick={() => setMode('spike')} className={`px-4 py-2 rounded-full font-bold shadow ${mode === 'spike' ? 'bg-orange-500 text-white' : 'bg-white'}`}>剣先</button>
      </div>

      {/* スコア */}
      <div className="absolute top-6 left-6 z-10 bg-white/80 px-4 py-2 rounded-xl shadow">
        <span className="text-xs font-bold text-gray-500 block">SCORE</span>
        <span className="text-3xl font-black text-gray-800">{score}</span>
      </div>

      {/* スタート画面 */}
      {gameState === 'start' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <h1 className="text-white text-5xl font-bold mb-8">KENDAMA</h1>
          <button onClick={requestPermission} className="bg-red-600 text-white px-10 py-5 rounded-full font-bold text-2xl shadow-xl hover:scale-105 transition flex items-center gap-2">
            <Play fill="currentColor" /> PLAY
          </button>
        </div>
      )}

      {/* 成功エフェクト */}
      {gameState === 'success' && (
        <div className="absolute top-1/3 w-full text-center pointer-events-none animate-bounce">
           <span className="text-6xl font-black text-red-500 drop-shadow-xl stroke-white">{mode === 'spike' ? 'SPIKE!!' : 'GREAT!'}</span>
        </div>
      )}

      <div className="absolute bottom-2 left-2 text-xs text-gray-400 font-mono">{debugInfo}</div>
    </div>
  )
}