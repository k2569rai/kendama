'use client'

import { useEffect, useRef, useState } from 'react'
import Matter from 'matter-js'
import { Play, Settings2, RefreshCw } from 'lucide-react'

// 型定義
type GameMode = 'cup' | 'spike' // 大皿モード or 剣先モード

export default function KendamaGame() {
  const sceneRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Matter.Engine | null>(null)
  const ballRef = useRef<Matter.Body | null>(null)
  const targetRef = useRef<Matter.Body | null>(null) // 皿または剣先

  const [score, setScore] = useState(0)
  const [mode, setMode] = useState<GameMode>('cup')
  const [gameState, setGameState] = useState<'start' | 'playing' | 'success'>('start')
  const [debugInfo, setDebugInfo] = useState('')

  // --- 1. 物理エンジンの初期化 & モード切替時の再描画 ---
  useEffect(() => {
    if (!sceneRef.current) return

    const { Engine, Render, World, Bodies, Constraint, Mouse, MouseConstraint, Runner, Composite } = Matter

    // エンジンがなければ作成（初回のみ）
    if (!engineRef.current) {
      engineRef.current = Engine.create()
      // 重力調整
      engineRef.current.world.gravity.y = 1.5
    }
    const engine = engineRef.current
    const world = engine.world

    // レンダラー作成（再描画のたびにキャンバスが増えないように中身をクリア）
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

    // 世界を一旦リセット（壁以外）
    World.clear(world, false) // keepStatic=falseだと全部消えるので注意

    // --- 物体の作成 ---
    const centerX = window.innerWidth / 2
    const bottomY = window.innerHeight

    // 1. 持ち手（共通）
    const handle = Bodies.rectangle(centerX, bottomY - 100, 30, 200, {
      isStatic: true,
      render: { fillStyle: '#8B4513' }
    })

    // 2. ターゲット（モードによって形を変える！）
    let targetBody: Matter.Body

    if (mode === 'cup') {
      // --- 大皿モード ---
      // 皿の底
      const base = Bodies.rectangle(centerX, bottomY - 210, 100, 20, {
        isStatic: true,
        render: { fillStyle: '#A0522D' }
      })
      // 左右の壁（こぼれ防止）
      const left = Bodies.rectangle(centerX - 55, bottomY - 230, 10, 60, { isStatic: true, render: { visible: false } })
      const right = Bodies.rectangle(centerX + 55, bottomY - 230, 10, 60, { isStatic: true, render: { visible: false } })
      
      targetBody = Matter.Body.create({
        parts: [base, left, right],
        isStatic: true,
        label: 'cup_target'
      })
    } else {
      // --- 剣先モード ---
      // 細い棒
      targetBody = Bodies.rectangle(centerX, bottomY - 250, 15, 150, {
        isStatic: true,
        label: 'spike_target',
        render: { fillStyle: '#CD853F' }
      })
    }
    
    targetRef.current = targetBody

    // 3. 玉
    const ball = Bodies.circle(centerX, bottomY - 400, 35, {
      restitution: 0.5,
      friction: 0.05,
      density: 0.04,
      label: 'ball',
      render: { fillStyle: '#DC143C' }
    })
    ballRef.current = ball

    // 4. 紐
    const string = Constraint.create({
      bodyA: handle,
      bodyB: ball,
      pointA: { x: 0, y: -80 },
      length: 300,
      stiffness: 0.1,
      damping: 0.05,
      render: { visible: true, strokeStyle: '#555', lineWidth: 3 }
    })

    // 5. 壁（画面外落下防止）
    const wallOpts = { isStatic: true, render: { visible: false } }
    const walls = [
      Bodies.rectangle(centerX, -200, window.innerWidth * 2, 50, wallOpts),
      Bodies.rectangle(-50, window.innerHeight / 2, 50, window.innerHeight * 2, wallOpts),
      Bodies.rectangle(window.innerWidth + 50, window.innerHeight / 2, 50, window.innerHeight * 2, wallOpts),
      Bodies.rectangle(centerX, window.innerHeight + 100, window.innerWidth * 2, 50, wallOpts),
    ]

    World.add(world, [handle, targetBody, ball, string, ...walls])

    // マウス操作（PC用）
    const mouse = Mouse.create(render.canvas)
    const mouseConstraint = MouseConstraint.create(engine, {
      mouse: mouse,
      constraint: { stiffness: 0.2, render: { visible: false } }
    })
    World.add(world, mouseConstraint)

    // 実行
    Render.run(render)
    const runner = Runner.create()
    Runner.run(runner, engine)

    return () => {
      Render.stop(render)
      Runner.stop(runner)
      if(runner) Runner.stop(runner)
    }
  }, [mode]) // ★ modeが変わるたびに再実行される

  // --- 2. 判定ループ（吸着ロジック） ---
  useEffect(() => {
    const interval = setInterval(() => {
      if (!ballRef.current || !targetRef.current || !engineRef.current) return

      const ball = ballRef.current
      const target = targetRef.current
      const engine = engineRef.current

      // 玉のスピード
      const speed = Math.sqrt(ball.velocity.x ** 2 + ball.velocity.y ** 2)

      if (mode === 'cup') {
        // --- 大皿判定 ---
        const dx = Math.abs(ball.position.x - target.position.x)
        const dy = ball.position.y - (target.position.y - 40) // 皿の少し上
        
        // 皿に乗っていて、静止している
        if (dx < 40 && Math.abs(dy) < 30 && speed < 2) {
          handleSuccess(ball)
        }
      } else {
        // --- 剣先判定（マグネット） ---
        // 剣の先端座標
        const tipY = target.position.y - 75 
        const dx = Math.abs(ball.position.x - target.position.x)
        const dy = Math.abs(ball.position.y - tipY)

        // 先端に近くて、ある程度スピードが落ちていたら
        if (dx < 25 && dy < 35 && speed < 8) {
           handleSuccess(ball, true) // true = 吸着発動
        }
      }

      // 成功状態から玉が離れたらプレイ中に戻す
      if (speed > 5 && gameState === 'success') {
        setGameState('playing')
      }
    }, 50)

    return () => clearInterval(interval)
  }, [mode, gameState])

  // 成功時の処理
  const handleSuccess = (ball: Matter.Body, magnet = false) => {
    if (gameState === 'success') return

    setScore(s => s + (mode === 'spike' ? 100 : 10)) // 剣先は高得点
    setGameState('success')
    if (navigator.vibrate) navigator.vibrate([50, 50, 50]) // 振動

    // マグネット処理：玉を強制的に固定する
    if (magnet && engineRef.current && targetRef.current) {
       const constraint = Matter.Constraint.create({
         bodyA: targetRef.current,
         bodyB: ball,
         pointA: { x: 0, y: -75 }, // 剣先の位置
         pointB: { x: 0, y: 0 },
         stiffness: 0.5, // 強く固定
         length: 0,
         render: { visible: false }
       })
       Matter.World.add(engineRef.current.world, constraint)
       
       // 1秒後に拘束を解く（また遊べるように）
       setTimeout(() => {
         Matter.World.remove(engineRef.current!.world, constraint)
       }, 1000)
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
       if (!engineRef.current) return
       const x = e.accelerationIncludingGravity?.x || 0
       const y = e.accelerationIncludingGravity?.y || 0
       setDebugInfo(`X:${x.toFixed(1)} Y:${y.toFixed(1)}`)
       // 重力制御
       engineRef.current.world.gravity.x = -x * 0.25
       // 縦持ちした時の角度補正などが必要ならここをいじる
    })
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-100 touch-none select-none">
      <div ref={sceneRef} className="absolute inset-0" />

      {/* モード切替UI */}
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <button 
          onClick={() => setMode('cup')}
          className={`p-3 rounded-xl font-bold transition shadow-md ${mode === 'cup' ? 'bg-red-600 text-white scale-110' : 'bg-white text-gray-500'}`}
        >
          大皿
        </button>
        <button 
          onClick={() => setMode('spike')}
          className={`p-3 rounded-xl font-bold transition shadow-md ${mode === 'spike' ? 'bg-orange-500 text-white scale-110' : 'bg-white text-gray-500'}`}
        >
          剣先
        </button>
      </div>

      {/* スコア・通知 */}
      <div className="absolute top-6 left-6 z-10 pointer-events-none">
        <div className="bg-white/80 backdrop-blur px-4 py-2 rounded-lg shadow border border-gray-200">
          <span className="text-xs font-bold text-gray-500 block">SCORE</span>
          <span className="text-3xl font-black text-gray-800">{score}</span>
        </div>
      </div>
      
      {gameState === 'success' && (
        <div className="absolute top-1/3 w-full text-center z-20 pointer-events-none">
          <div className="text-6xl font-black text-red-500 drop-shadow-xl animate-bounce">
             {mode === 'spike' ? 'SPIKE!!' : 'GREAT!'}
          </div>
        </div>
      )}

      {/* スタート画面 */}
      {gameState === 'start' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <h1 className="text-white text-5xl font-bold mb-8 drop-shadow-lg tracking-tighter">KENDAMA</h1>
          <button
            onClick={requestPermission}
            className="flex items-center gap-3 bg-red-600 text-white px-10 py-5 rounded-full font-bold text-2xl shadow-xl hover:scale-105 transition animate-pulse"
          >
            <Play fill="currentColor" size={32} /> PLAY
          </button>
          <div className="mt-8 text-gray-300 text-center text-sm">
            <p>スマホを振って玉を操ろう</p>
            <p>Please enable motion sensors</p>
          </div>
        </div>
      )}

      {/* デバッグ用 */}
      <div className="absolute bottom-2 right-2 text-[10px] text-gray-400 font-mono">
        {debugInfo}
      </div>
    </div>
  )
}