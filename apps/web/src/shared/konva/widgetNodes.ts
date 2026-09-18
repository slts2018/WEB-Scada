import Konva from 'konva'
import { parseListItems, parseSeries, type Widget2D } from '@web-scada/core'

function num(style: Record<string, unknown>, key: string, fallback: number) {
  const v = style[key]
  return typeof v === 'number' ? v : fallback
}

function str(style: Record<string, unknown>, key: string, fallback: string) {
  const v = style[key]
  return typeof v === 'string' ? v : fallback
}

/** 根据 Widget2D 创建对应 Konva 节点（含 Group 包装，统一 transform） */
export function createWidgetNode(widget: Widget2D): Konva.Group {
  const group = new Konva.Group({
    id: widget.id,
    name: 'widget',
    x: widget.transform.x,
    y: widget.transform.y,
    rotation: widget.transform.rotation,
    scaleX: widget.transform.scaleX,
    scaleY: widget.transform.scaleY,
    draggable: !widget.locked,
    visible: widget.visible !== false,
  })
  group.setAttr('widgetId', widget.id)
  group.setAttr('widgetType', widget.type)

  const shape = buildShape(widget)
  group.add(shape)
  return group
}

function buildShape(widget: Widget2D): Konva.Shape | Konva.Group {
  const { width, height } = widget.transform
  const style = widget.style
  const opacity = num(style, 'opacity', 1)

  switch (widget.type) {
    case 'circle': {
      return new Konva.Ellipse({
        name: 'shape',
        x: width / 2,
        y: height / 2,
        radiusX: Math.max(width / 2, 1),
        radiusY: Math.max(height / 2, 1),
        fill: str(style, 'fill', '#22c55e'),
        stroke: str(style, 'stroke', '#86efac'),
        strokeWidth: num(style, 'strokeWidth', 2),
        opacity,
      })
    }
    case 'line': {
      return new Konva.Line({
        name: 'shape',
        points: [0, height / 2, width, height / 2],
        stroke: str(style, 'stroke', '#f8fafc'),
        strokeWidth: num(style, 'strokeWidth', 3),
        lineCap: 'round',
        opacity,
        hitStrokeWidth: 16,
      })
    }
    case 'pipe':
    case 'polyline':
    case 'polygon': {
      const raw = widget.props.points
      const pts = Array.isArray(raw)
        ? (raw as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n))
        : widget.type === 'pipe'
          ? [0, height / 2, width, height / 2]
          : [0, 0, width, height / 2, width, height]
      const closed = widget.type === 'polygon'
      const isPipe = widget.type === 'pipe'
      return new Konva.Line({
        name: 'shape',
        points: pts.length >= 4 ? pts : [0, 0, Math.max(width, 4), Math.max(height, 4)],
        closed,
        fill: closed ? str(style, 'fill', '#3d8bfd') : undefined,
        stroke: str(style, 'stroke', isPipe ? '#94a3b8' : closed ? '#93c5fd' : '#f8fafc'),
        strokeWidth: num(style, 'strokeWidth', isPipe ? 8 : closed ? 2 : 3),
        lineJoin: 'round',
        lineCap: 'round',
        opacity,
        hitStrokeWidth: closed ? undefined : 16,
      })
    }
    case 'text': {
      return new Konva.Text({
        name: 'shape',
        width,
        height,
        text: String(widget.props.text ?? '文本'),
        fill: str(style, 'fill', '#e8eaed'),
        fontSize: num(style, 'fontSize', 20),
        align: str(style, 'align', 'left') as 'left' | 'center' | 'right',
        verticalAlign: 'middle',
        opacity,
      })
    }
    case 'button': {
      const g = new Konva.Group({ name: 'shape' })
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: str(style, 'fill', '#2563eb'),
          stroke: str(style, 'stroke', '#93c5fd'),
          strokeWidth: num(style, 'strokeWidth', 1),
          cornerRadius: num(style, 'cornerRadius', 6),
          opacity,
        }),
      )
      g.add(
        new Konva.Text({
          width,
          height,
          text: String(widget.props.text ?? '按钮'),
          fill: str(style, 'textColor', '#ffffff'),
          fontSize: num(style, 'fontSize', 14),
          align: 'center',
          verticalAlign: 'middle',
          listening: false,
        }),
      )
      return g
    }
    case 'image': {
      const g = new Konva.Group({ name: 'shape' })
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: '#111827',
          stroke: str(style, 'stroke', '#3d4454'),
          strokeWidth: num(style, 'strokeWidth', 1),
          opacity,
        }),
      )
      const src = String(widget.props.src || '')
      if (src) {
        const imageObj = new window.Image()
        imageObj.onload = () => {
          const existing = g.findOne('.img')
          existing?.destroy()
          g.add(
            new Konva.Image({
              name: 'img',
              image: imageObj,
              width,
              height,
              opacity,
              listening: false,
            }),
          )
          g.getLayer()?.batchDraw()
        }
        imageObj.src = src
      } else {
        g.add(
          new Konva.Text({
            width,
            height,
            text: '无图片',
            align: 'center',
            verticalAlign: 'middle',
            fill: '#64748b',
            fontSize: 12,
            listening: false,
          }),
        )
      }
      return g
    }
    case 'scene3d': {
      const g = new Konva.Group({ name: 'shape' })
      const page3dId = String(widget.props.page3dId || '')
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: str(style, 'fill', '#0b1220'),
          stroke: str(style, 'stroke', '#3d8bfd'),
          strokeWidth: num(style, 'strokeWidth', 1),
          cornerRadius: num(style, 'cornerRadius', 4),
          dash: [8, 5],
          opacity,
        }),
      )
      g.add(
        new Konva.Text({
          width,
          height,
          text: page3dId ? `三维画面\n${page3dId.slice(-8)}` : '三维画面\n（未选择页面）',
          align: 'center',
          verticalAlign: 'middle',
          fill: str(style, 'textColor', '#93c5fd'),
          fontSize: num(style, 'fontSize', 13),
          lineHeight: 1.4,
          listening: false,
        }),
      )
      return g
    }
    case 'valve': {
      const g = new Konva.Group({ name: 'shape' })
      const body = str(style, 'fill', '#64748b')
      const stroke = str(style, 'stroke', '#cbd5e1')
      const accent = str(style, 'accent', '#38bdf8')
      g.add(
        new Konva.Line({
          points: [0, height / 2, width, height / 2],
          stroke,
          strokeWidth: 6,
          lineCap: 'round',
          listening: false,
        }),
      )
      g.add(
        new Konva.RegularPolygon({
          x: width / 2,
          y: height / 2,
          sides: 4,
          radius: Math.min(width, height) * 0.42,
          fill: body,
          stroke,
          strokeWidth: 2,
          opacity,
        }),
      )
      if (widget.props.open !== false) {
        g.add(
          new Konva.Circle({
            x: width / 2,
            y: height / 2,
            radius: 4,
            fill: accent,
            listening: false,
          }),
        )
      }
      return g
    }
    case 'pump': {
      const g = new Konva.Group({ name: 'shape' })
      const running = Boolean(widget.props.running)
      g.add(
        new Konva.Ellipse({
          x: width / 2,
          y: height / 2,
          radiusX: width / 2,
          radiusY: height / 2,
          fill: str(style, 'fill', '#0ea5e9'),
          stroke: str(style, 'stroke', '#7dd3fc'),
          strokeWidth: num(style, 'strokeWidth', 2),
          opacity,
        }),
      )
      g.add(
        new Konva.RegularPolygon({
          x: width / 2,
          y: height / 2,
          sides: 3,
          radius: Math.min(width, height) * 0.28,
          rotation: running ? 90 : 0,
          fill: '#e0f2fe',
          listening: false,
        }),
      )
      return g
    }
    case 'lamp': {
      const on = widget.props.on !== false
      const fill = on ? str(style, 'fill', '#22c55e') : '#334155'
      return new Konva.Ellipse({
        name: 'shape',
        x: width / 2,
        y: height / 2,
        radiusX: width / 2,
        radiusY: height / 2,
        fill,
        stroke: str(style, 'stroke', '#14532d'),
        strokeWidth: num(style, 'strokeWidth', 2),
        shadowColor: on ? fill : undefined,
        shadowBlur: on ? 18 : 0,
        opacity,
      })
    }
    case 'tank': {
      const g = new Konva.Group({ name: 'shape' })
      const level = Math.min(100, Math.max(0, Number(widget.props.level ?? 60)))
      const liquidH = (height - 8) * (level / 100)
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: str(style, 'fill', '#1e293b'),
          stroke: str(style, 'stroke', '#94a3b8'),
          strokeWidth: num(style, 'strokeWidth', 2),
          cornerRadius: 10,
          opacity,
        }),
      )
      g.add(
        new Konva.Rect({
          x: 4,
          y: height - 4 - liquidH,
          width: width - 8,
          height: liquidH,
          fill: str(style, 'liquid', '#38bdf8'),
          cornerRadius: 6,
          listening: false,
        }),
      )
      g.add(
        new Konva.Text({
          width,
          height,
          text: `${level}%`,
          align: 'center',
          verticalAlign: 'middle',
          fill: '#e2e8f0',
          fontSize: 14,
          listening: false,
        }),
      )
      return g
    }
    case 'value': {
      const g = new Konva.Group({ name: 'shape' })
      const decimals = Number(widget.props.decimals ?? 1)
      const raw = widget.props.value
      const numVal = typeof raw === 'number' ? raw : Number(raw)
      const display = Number.isFinite(numVal)
        ? numVal.toFixed(Math.max(0, Math.min(6, decimals)))
        : String(raw ?? '--')
      const unit = String(widget.props.unit ?? '')
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: str(style, 'fill', '#0f172a'),
          stroke: str(style, 'stroke', '#334155'),
          strokeWidth: num(style, 'strokeWidth', 1),
          cornerRadius: num(style, 'cornerRadius', 8),
          opacity,
        }),
      )
      g.add(
        new Konva.Text({
          x: 10,
          y: 8,
          width: width - 20,
          text: String(widget.props.label ?? ''),
          fill: str(style, 'labelColor', '#94a3b8'),
          fontSize: 12,
          listening: false,
        }),
      )
      g.add(
        new Konva.Text({
          x: 10,
          y: height / 2 - 4,
          width: width - 20,
          text: unit ? `${display} ${unit}` : display,
          fill: str(style, 'textColor', '#38bdf8'),
          fontSize: num(style, 'fontSize', 22),
          fontStyle: 'bold',
          listening: false,
        }),
      )
      return g
    }
    case 'switch': {
      const g = new Konva.Group({ name: 'shape' })
      const on = widget.props.on === true || widget.props.on === 'true'
      const trackH = Math.min(height * 0.55, 28)
      const trackY = (height - trackH) / 2
      const pad = 4
      const knobR = trackH / 2 - 3
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: 'transparent',
          opacity,
        }),
      )
      g.add(
        new Konva.Rect({
          x: 0,
          y: trackY,
          width,
          height: trackH,
          fill: on ? str(style, 'fill', '#22c55e') : str(style, 'offFill', '#475569'),
          stroke: str(style, 'stroke', '#94a3b8'),
          strokeWidth: num(style, 'strokeWidth', 1),
          cornerRadius: trackH / 2,
        }),
      )
      g.add(
        new Konva.Circle({
          x: on ? width - pad - knobR : pad + knobR,
          y: height / 2,
          radius: knobR,
          fill: '#f8fafc',
          listening: false,
        }),
      )
      const label = String(widget.props.label ?? '')
      if (label) {
        g.add(
          new Konva.Text({
            y: trackY - 16,
            width,
            text: label,
            fill: str(style, 'textColor', '#e2e8f0'),
            fontSize: num(style, 'fontSize', 12),
            align: 'center',
            listening: false,
          }),
        )
      }
      return g
    }
    case 'list':
    case 'alarm': {
      const g = new Konva.Group({ name: 'shape' })
      const rows = parseListItems(widget.props.items)
      const rowH = Math.max(18, Number(widget.props.rowHeight ?? 28))
      const title = String(widget.props.title ?? (widget.type === 'alarm' ? '实时报警' : ''))
      const isAlarm = widget.type === 'alarm'
      let y = 0
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: str(style, 'fill', isAlarm ? '#140f0f' : '#0f172a'),
          stroke: str(style, 'stroke', isAlarm ? '#7f1d1d' : '#334155'),
          strokeWidth: num(style, 'strokeWidth', 1),
          cornerRadius: num(style, 'cornerRadius', 6),
          opacity,
        }),
      )
      if (title) {
        g.add(
          new Konva.Text({
            x: 8,
            y: 6,
            width: width - 16,
            text: title,
            fill: str(style, 'headerColor', isAlarm ? '#fca5a5' : '#94a3b8'),
            fontSize: num(style, 'fontSize', 12),
            fontStyle: 'bold',
            listening: false,
          }),
        )
        y = 26
      } else {
        y = 6
      }
      rows.forEach((cols, i) => {
        if (y + rowH > height) return
        if (i % 2 === 1) {
          g.add(
            new Konva.Rect({
              x: 1,
              y,
              width: width - 2,
              height: rowH,
              fill: str(style, 'rowAlt', isAlarm ? '#1c1212' : '#111827'),
              listening: false,
            }),
          )
        }
        const level = String(cols[1] ?? '').trim()
        let rowColor = str(style, 'textColor', isAlarm ? '#fecaca' : '#e2e8f0')
        if (isAlarm) {
          if (level.includes('故障') || level.toLowerCase() === 'error') rowColor = '#f87171'
          else if (level.includes('告警') || level.includes('报警')) rowColor = '#fb923c'
          else if (level.includes('提示')) rowColor = '#fbbf24'
        }
        g.add(
          new Konva.Text({
            x: 8,
            y: y + (rowH - num(style, 'fontSize', 12)) / 2 - 1,
            width: width - 16,
            text: cols.join('    '),
            fill: rowColor,
            fontSize: num(style, 'fontSize', 12),
            listening: false,
          }),
        )
        y += rowH
      })
      return g
    }
    case 'chart':
    case 'trend': {
      const g = new Konva.Group({ name: 'shape' })
      const series = parseSeries(widget.props.series)
      const chartType = String(widget.props.chartType ?? 'line')
      const pad = { t: 28, r: 12, b: 16, l: 12 }
      const plotW = Math.max(10, width - pad.l - pad.r)
      const plotH = Math.max(10, height - pad.t - pad.b)
      let min = Number(widget.props.min)
      let max = Number(widget.props.max)
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = series.length ? Math.min(...series) : 0
        max = series.length ? Math.max(...series) : 1
      }
      if (max <= min) max = min + 1
      const isTrend = widget.type === 'trend'
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: str(style, 'fill', isTrend ? '#0b1220' : '#0f172a'),
          stroke: str(style, 'stroke', isTrend ? '#1e3a5f' : '#334155'),
          strokeWidth: num(style, 'strokeWidth', 1),
          cornerRadius: num(style, 'cornerRadius', 6),
          opacity,
        }),
      )
      g.add(
        new Konva.Text({
          x: 10,
          y: 6,
          width: width - 20,
          text: String(widget.props.title ?? (isTrend ? '实时趋势' : '趋势')),
          fill: str(style, 'textColor', '#94a3b8'),
          fontSize: num(style, 'fontSize', 11),
          listening: false,
        }),
      )
      for (let i = 0; i < 4; i++) {
        const gy = pad.t + (plotH * i) / 3
        g.add(
          new Konva.Line({
            points: [pad.l, gy, pad.l + plotW, gy],
            stroke: str(style, 'gridColor', '#1e293b'),
            strokeWidth: 1,
            listening: false,
          }),
        )
      }
      if (series.length) {
        if (chartType === 'bar') {
          const bw = plotW / series.length
          series.forEach((v, i) => {
            const t = (v - min) / (max - min)
            const bh = Math.max(1, plotH * t)
            g.add(
              new Konva.Rect({
                x: pad.l + i * bw + bw * 0.15,
                y: pad.t + plotH - bh,
                width: bw * 0.7,
                height: bh,
                fill: str(style, 'barColor', '#3d8bfd'),
                listening: false,
              }),
            )
          })
        } else {
          const pts: number[] = []
          series.forEach((v, i) => {
            const x = pad.l + (series.length === 1 ? plotW / 2 : (plotW * i) / (series.length - 1))
            const t = (v - min) / (max - min)
            const y = pad.t + plotH - plotH * t
            pts.push(x, y)
          })
          g.add(
            new Konva.Line({
              points: pts,
              stroke: str(style, 'lineColor', '#38bdf8'),
              strokeWidth: 2,
              lineJoin: 'round',
              lineCap: 'round',
              tension: 0.2,
              listening: false,
            }),
          )
          for (let i = 0; i < pts.length; i += 2) {
            g.add(
              new Konva.Circle({
                x: pts[i],
                y: pts[i + 1],
                radius: 2.5,
                fill: str(style, 'lineColor', '#38bdf8'),
                listening: false,
              }),
            )
          }
        }
      }
      return g
    }
    case 'gauge': {
      const g = new Konva.Group({ name: 'shape' })
      const minV = Number(widget.props.min ?? 0)
      const maxV = Number(widget.props.max ?? 100)
      const value = Number(widget.props.value ?? 0)
      const span = maxV - minV || 1
      const ratio = Math.min(1, Math.max(0, (value - minV) / span))
      const cx = width / 2
      const cy = height * 0.62
      const r = Math.min(width, height) * 0.38
      const start = Math.PI
      const needle = start + Math.PI * ratio
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: str(style, 'fill', '#0f172a'),
          stroke: str(style, 'stroke', '#334155'),
          strokeWidth: num(style, 'strokeWidth', 1),
          cornerRadius: 8,
          opacity,
        }),
      )
      g.add(
        new Konva.Arc({
          x: cx,
          y: cy,
          innerRadius: r - 10,
          outerRadius: r,
          angle: 180,
          rotation: 180,
          fill: str(style, 'trackColor', '#1e293b'),
          listening: false,
        }),
      )
      g.add(
        new Konva.Arc({
          x: cx,
          y: cy,
          innerRadius: r - 10,
          outerRadius: r,
          angle: 180 * ratio,
          rotation: 180,
          fill: str(style, 'valueColor', '#38bdf8'),
          listening: false,
        }),
      )
      g.add(
        new Konva.Line({
          points: [cx, cy, cx + Math.cos(needle) * (r - 14), cy + Math.sin(needle) * (r - 14)],
          stroke: '#f8fafc',
          strokeWidth: 2,
          lineCap: 'round',
          listening: false,
        }),
      )
      g.add(
        new Konva.Circle({
          x: cx,
          y: cy,
          radius: 4,
          fill: '#f8fafc',
          listening: false,
        }),
      )
      const unit = String(widget.props.unit ?? '')
      g.add(
        new Konva.Text({
          y: 8,
          width,
          text: String(widget.props.label ?? ''),
          align: 'center',
          fill: str(style, 'textColor', '#e2e8f0'),
          fontSize: 12,
          listening: false,
        }),
      )
      g.add(
        new Konva.Text({
          y: cy + 8,
          width,
          text: unit ? `${value}${unit}` : String(value),
          align: 'center',
          fill: str(style, 'valueColor', '#38bdf8'),
          fontSize: num(style, 'fontSize', 18),
          fontStyle: 'bold',
          listening: false,
        }),
      )
      return g
    }
    case 'group': {
      const g = new Konva.Group({ name: 'shape' })
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: 'rgba(61,139,253,0.06)',
          stroke: str(style, 'stroke', '#3d8bfd'),
          strokeWidth: num(style, 'strokeWidth', 1),
          dash: [6, 4],
          opacity,
        }),
      )
      for (const child of widget.children ?? []) {
        const childNode = createWidgetNode(child)
        childNode.draggable(false)
        childNode.listening(false)
        g.add(childNode)
      }
      return g
    }
    case 'rect':
    case 'roundRect':
    default: {
      const fillRatio = Number(widget.props.fillRatio)
      const hasFill = Number.isFinite(fillRatio) && fillRatio >= 0
      const defaultRadius = widget.type === 'roundRect' ? 20 : 4
      if (!hasFill) {
        return new Konva.Rect({
          name: 'shape',
          width,
          height,
          fill: str(style, 'fill', '#3d8bfd'),
          stroke: str(style, 'stroke', '#93c5fd'),
          strokeWidth: num(style, 'strokeWidth', 2),
          cornerRadius: num(style, 'cornerRadius', defaultRadius),
          opacity,
        })
      }
      const g = new Konva.Group({ name: 'shape' })
      const orient = String(widget.props.fillOrient ?? 'v')
      const dir = String(widget.props.fillDirection ?? 'start')
      const pct = Math.min(100, Math.max(0, fillRatio)) / 100
      const fillColor = str(style, 'fill', '#3d8bfd')
      const emptyColor = str(style, 'emptyFill', '#1e293b')
      g.add(
        new Konva.Rect({
          width,
          height,
          fill: emptyColor,
          stroke: str(style, 'stroke', '#93c5fd'),
          strokeWidth: num(style, 'strokeWidth', 2),
          cornerRadius: num(style, 'cornerRadius', defaultRadius),
          opacity,
        }),
      )
      let fx = 0
      let fy = 0
      let fw = width
      let fh = height
      if (orient === 'h') {
        fw = width * pct
        if (dir === 'end') fx = width - fw
      } else {
        fh = height * pct
        if (dir === 'start') fy = height - fh
      }
      g.add(
        new Konva.Rect({
          x: fx,
          y: fy,
          width: Math.max(0, fw),
          height: Math.max(0, fh),
          fill: fillColor,
          opacity,
          listening: false,
        }),
      )
      return g
    }
  }
}

/** 用最新 Widget 数据刷新已有节点外观与尺寸（保持选中） */
export function syncWidgetNode(group: Konva.Group, widget: Widget2D) {
  group.position({ x: widget.transform.x, y: widget.transform.y })
  group.rotation(widget.transform.rotation)
  group.scale({ x: widget.transform.scaleX, y: widget.transform.scaleY })
  group.draggable(!widget.locked)
  group.visible(widget.visible !== false)

  group.findOne('.shape')?.destroy()
  group.add(buildShape(widget))
}

/** 从 Konva Group 读回 transform（Transformer 后调用） */
export function readTransformFromNode(group: Konva.Group): Widget2D['transform'] {
  const type = String(group.getAttr('widgetType') || 'rect')
  const scaleX = group.scaleX()
  const scaleY = group.scaleY()

  let width = 0
  let height = 0
  const shape = group.findOne('.shape')

  if ((type === 'circle' || type === 'lamp') && shape instanceof Konva.Ellipse) {
    width = Math.max(2, shape.radiusX() * 2 * scaleX)
    height = Math.max(2, shape.radiusY() * 2 * scaleY)
  } else if ((type === 'line') && shape instanceof Konva.Line) {
    const pts = shape.points()
    width = Math.max(4, Math.abs(pts[2] - pts[0]) * scaleX)
    height = Math.max(0, Math.abs(pts[3] - pts[1]) * scaleY)
  } else if (
    (type === 'polyline' || type === 'polygon' || type === 'pipe') &&
    shape instanceof Konva.Line
  ) {
    const pts = shape.points()
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i])
      minY = Math.min(minY, pts[i + 1])
      maxX = Math.max(maxX, pts[i])
      maxY = Math.max(maxY, pts[i + 1])
    }
    width = Math.max(4, (maxX - minX) * scaleX)
    height = Math.max(4, (maxY - minY) * scaleY)
  } else if (shape instanceof Konva.Text || shape instanceof Konva.Rect) {
    width = Math.max(4, shape.width() * scaleX)
    height = Math.max(4, shape.height() * scaleY)
  } else if (shape instanceof Konva.Group) {
    const box = shape.getClientRect({ skipTransform: true })
    width = Math.max(4, box.width * scaleX)
    height = Math.max(4, box.height * scaleY)
  } else {
    width = Math.max(4, 40 * scaleX)
    height = Math.max(4, 40 * scaleY)
  }

  group.scale({ x: 1, y: 1 })

  return {
    x: group.x(),
    y: group.y(),
    width,
    height,
    rotation: group.rotation(),
    scaleX: 1,
    scaleY: 1,
  }
}
