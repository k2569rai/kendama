'use client'

import { useEffect, useRef, useState } from 'react'
import Matter from 'matter-js'
import { RefreshCw, Play, Info } from 'lucide-react'

export default function KendamaGame() {
  const sceneRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Matter.Engine | null>(null)
  const ballRef = useRef<Matter.Body | null>(null)
  const cupRef = useRef<Matter.Body | null>(null)

  const [score, setScore] = useState(0)
  const [gameState, setGameState] = useState<'start' | 'playing' | 'success'>('start')
  const [debugInfo, setDebugInfo] = useState('') // デバッグ用（傾きの数値確認）

  // --- 1. 物理エンジンの初期化 ---
  useEffect(() => {
    if (!sceneRef.current) return

    const { Engine, Render, World, Bodies, Constraint, Mouse, MouseConstraint, Runner } = Matter

    // エンジン作成
    const engine = Engine.create()
    engineRef.current = engine

    // 重力を少し強めに設定（リアルな挙動のため）
    engine.world.gravity.y = 1.5

    // レンダラー作成
    const render = Render.create({
      element: sceneRef.current,
      engine: engine,
      options: {
        width: window.innerWidth,
        height: window.innerHeight,
        wireframes: false, // 塗りつぶしあり
        background: '#f0f9ff', // 空っぽい背景色
        pixelRatio: window.devicePixelRatio // スマホで綺麗に見せる
      }
    })

    // --- 物体の作成 ---
    const centerX = window.innerWidth / 2
    const bottomY = window.innerHeight

    // 1. 持ち手（動かない）
    const handle = Bodies.rectangle(centerX, bottomY - 100, 30, 150, {
      isStatic: true,
      render: { fillStyle: '#8B4513' } // 木の色
    })

    // 2. 大皿（当たり判定用）
    // 台形を作るのは難しいので、四角形で代用しつつ見た目を調整
    const cup = Bodies.rectangle(centerX, bottomY - 180, 100, 20, {
      isStatic: true,
      label: 'cup',
      render: { fillStyle: '#A0522D' }
    })
    cupRef.current = cup

    // 皿の「壁」（玉がこぼれないように左右に小さな壁を作る）
    const cupLeft = Bodies.rectangle(centerX - 50, bottomY - 200, 10, 40, { isStatic: true, render: { visible: false } })
    const cupRight = Bodies.rectangle(centerX + 50, bottomY - 200, 10, 40, { isStatic: true, render: { visible: false } })

    // 3. 玉
    const ball = Bodies.circle(centerX, bottomY - 400, 40, {
      restitution: 0.6, // 跳ね返り具合
      friction: 0.05,
      density: 0.04, // 重さ
      label: 'ball',
      render: { fillStyle: '#DC143C' } // 赤色
    })
    ballRef.current = ball

    // 4. 紐（Constraint）
    const string = Constraint.create({
      bodyA: handle,
      bodyB: ball,
      pointB: { x: 0, y: 0 },
      pointA: { x: 0, y: -70 }, // 持ち手の先端から
      length: 250,
      stiffness: 0.1,
      damping: 0.05,
      render: {
        visible: true,
        strokeStyle: '#555',
        lineWidth: 3
      }
    })

    // 5. 壁（画面外落下防止）
    const wallOpts = { isStatic: true, render: { visible: false } }
    const walls = [
      Bodies.rectangle(centerX, -100, window.innerWidth * 2, 50, wallOpts), // 天井
      Bodies.rectangle(-50, window.innerHeight / 2, 50, window.innerHeight * 2, wallOpts), // 左
      Bodies.rectangle(window.innerWidth + 50, window.innerHeight / 2, 50, window.innerHeight * 2, wallOpts), // 右
      Bodies.rectangle(centerX, window.innerHeight + 50, window.innerWidth * 2, 50, wallOpts), // 床
    ]

    // 世界に追加
    World.add(engine.world, [handle, cup, cupLeft, cupRight, ball, string, ...walls])

    // マウス操作（PCでのテスト用）
    const mouse = Mouse.create(render.canvas)
    const mouseConstraint = MouseConstraint.create(engine, {
      mouse: mouse,
      constraint: { stiffness: 0.2, render: { visible: false } }
    })
    World.add(engine.world, mouseConstraint)

    // 実行
    Render.run(render)
    const runner = Runner.create()
    Runner.run(runner, engine)

    return () => {
      Render.stop(render)
      Runner.stop(runner)
      World.clear(engine.world, false)
      Engine.clear(engine)
    }
  }, [])

  // --- 2. 判定ループ ---
  useEffect(() => {
    const interval = setInterval(() => {
      if (!ballRef.current || !cupRef.current) return

      const ball = ballRef.current
      const cup = cupRef.current

      // 玉と皿の距離
      const dx = Math.abs(ball.position.x - cup.position.x)
      const dy = ball.position.y - (cup.position.y - 30) // 皿の少し上

      // 速度（静止しているか？）
      const speed = Math.sqrt(ball.velocity.x ** 2 + ball.velocity.y ** 2)

      // 判定条件：横ズレが小さく、高さが皿のちょっと上で、スピードが遅い
      if (dx < 30 && dy > -20 && dy < 20 && speed < 3) {
        setGameState((prev) => {
          if (prev !== 'success') {
            setScore((s) => s + 1)
            // 成功したら少しバイブレーション（スマホのみ）
            if (navigator.vibrate) navigator.vibrate(50)
            return 'success'
          }
          return prev
        })
      } else if (speed > 5) {
        // 動いているときはプレイ中に戻す
        setGameState((prev) => prev === 'success' ? 'playing' : prev)
      }
    }, 100)

    return () => clearInterval(interval)
  }, [])

  // --- 3. センサー処理 ---
  const requestPermission = async () => {
    // iOS 13+ のための権限リクエスト
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      try {
        const res = await (DeviceMotionEvent as any).requestPermission()
        if (res === 'granted') {
          startSensor()
        } else {
          alert('センサーの使用が許可されませんでした')
        }
      } catch (e) {
        console.error(e)
      }
    } else {
      // Android / PC
      startSensor()
    }
  }

  const startSensor = () => {
    setGameState('playing')
    window.addEventListener('devicemotion', handleMotion)
  }

  const handleMotion = (event: DeviceMotionEvent) => {
    if (!engineRef.current) return

    // 加速度を取得
    const x = event.accelerationIncludingGravity?.x || 0
    const y = event.accelerationIncludingGravity?.y || 0

    setDebugInfo(`X: ${x.toFixed(1)}, Y: ${y.toFixed(1)}`)

    // 重力ベクトルを更新（これで「揺れ」を再現）
    // 画面の向きに合わせて調整が必要ですが、まずは単純に代入
    engineRef.current.world.gravity.x = -x * 0.2
    
    // 振った時の「引き上げ」動作を検知したい場合
    // yの値が急激に変化したら、玉に上方向の力を加えるなどの処理をここに追加できます
  }

  // --- UI ---
  return (
    <div className="fixed inset-0 overflow-hidden touch-none select-none">
      <div ref={sceneRef} className="absolute inset-0" />

      {/* スタート画面 */}
      {gameState === 'start' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <h1 className="text-white text-4xl font-bold mb-8 drop-shadow-md">KENDAMA</h1>
          <button
            onClick={requestPermission}
            className="flex items-center gap-2 bg-red-600 text-white px-8 py-4 rounded-full font-bold text-xl shadow-lg hover:scale-105 transition animate-pulse"
          >
            <Play fill="currentColor" /> スタート
          </button>
          <p className="text-gray-300 mt-4 text-sm">※スマホの傾き許可が必要です</p>
        </div>
      )}

      {/* スコア・UI */}
      <div className="absolute top-6 left-0 right-0 flex flex-col items-center pointer-events-none">
        <div className="bg-white/80 backdrop-blur px-6 py-2 rounded-full shadow-sm border border-gray-200">
          <span className="text-gray-500 text-xs font-bold uppercase mr-2">Score</span>
          <span className="text-3xl font-black text-gray-800">{score}</span>
        </div>
        
        {gameState === 'success' && (
          <div className="mt-4 text-4xl font-bold text-red-500 drop-shadow-lg animate-bounce">
            大皿成功！
          </div>
        )}
      </div>

      {/* デバッグ表示（開発用） */}
      <div className="absolute bottom-4 left-4 text-[10px] text-gray-400 font-mono bg-white/50 p-1 rounded">
        {debugInfo}
      </div>
    </div>
  )
}