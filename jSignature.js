/**
 * jSignature v1.2
 * 
 * Copyright (c) 2010 Brinley Ang 
 * http://www.unbolt.net
 * 
 * Released under the MIT License <http://www.opensource.org/licenses/mit-license.php> 
 */
(function($) { var methods = {
	init : function( options ) {
		if(!document.createElement('canvas').getContext)
		{
			alert("Oops, you need a newer browser to use this.")
			return
		}

		var settings = {
			'width' : 'max'
			,'height' : 'max'
			,'sizeRatio': 4
			,'color' : '#000'
			,'lineWidth' : 0
			,'bgcolor': '#fff'
		}

		if (options) {
			$.extend(settings, options)
		}
		
		return this.each( function() {


			var $parent = $(this)
			
			if (settings.width == 'max' || settings.height == 'max'){
				// this maxes the sig widget within the parent container.
				var pw = $parent.width()
					, ph = $parent.height()
				if ((pw / settings.sizeRatio) > ph) {
					ph = parseInt(pw/settings.sizeRatio)
				}
				settings.width = pw
				settings.height = ph					
			}
			
			if (settings.lineWidth == 0){
				var width = parseInt(settings.width)
					, lineWidth = parseInt( width / 300 ) // +1 pixel for every extra 300px of width.
				if (lineWidth < 2) {
				    settings.lineWidth = 2 
				} else {
					settings.lineWidth = lineWidth
				}
			}
			
			var $canvas = $("<canvas width='"+settings.width+"' height='"+settings.height+"'></canvas>") 
				, canvas = $canvas.appendTo($parent).get(0)
			$canvas.data('signature.settings', settings)

			if (!canvas || !canvas.getContext) {
				return
			}

			canvas.onselectstart = function(e){e.preventDefault(); e.stopPropagation(); return false;}

//				// Add custom class if defined
//				if(settings.cssclass && $.trim(settings.cssclass)!="") {
//					$(canvas).addClass(settings.cssclass)
//				}

			/*
			 * About data structure:
			 * We don't store / deal with "pictures" this signature capture code captures "vectors"
			 * 
			 * We don't store bitmaps. We store "strokes" as arrays of arrays.
			 * 
			 * Stroke = mousedown + mousemoved * n (+ mouseup but we don't record that as that was the "end / lack of movement" indicator)
			 * 
			 * Vectors = not classical vectors where numbers indicated shift relative last position. Our vectors are actually coordinates against top left of canvas.
			 * 			we could calc the classical vectors, but keeping the the actual coordinates allows us (through Math.max / min) 
			 * 			to calc the size of resulting drawing very quickly. If we want classical vectors later, we can always get them in backend code.
			 * 
			 * So, the data structure:
			 * 
			 * var data = [
			 * 	{ // stroke starts
			 * 		x : [101, 98, 57, 43] // x points
			 * 		, y : [1, 23, 65, 87] // y points
			 * 	} // stroke ends
			 * 	, { // stroke starts
			 * 		x : [55, 56, 57, 58] // x points
			 * 		, y : [101, 97, 54, 4] // y points
			 * 	} // stroke ends
			 * 	, { // stroke consisting of just a dot
			 * 		x : [53] // x points
			 * 		, y : [151] // y points
			 * 	} // stroke ends
			 * ]
			 * 
			 * we don't care or store stroke width (it's canvas-size-relative), color, shadow values. These can be added / changed on whim post-capture.
			 * 
			 */
			
			var ctx = canvas.getContext("2d")
				, resetCanvas = function(){
					ctx.clearRect(0, 0, canvas.width, canvas.height)
					
					ctx.lineWidth = parseInt(settings.lineWidth)
					ctx.strokeStyle = settings.color
					ctx.lineCap = ctx.lineJoin = "round"
					ctx.fillStyle = "rgba(0,0,0,0)"

					ctx.shadowColor = ctx.strokeStyle
					ctx.shadowOffsetX = settings.lineWidth * 0.5
					ctx.shadowOffsetY = settings.lineWidth * -0.6
					ctx.shadowBlur = 0
					
					data = []
					$canvas.data('signature.data', data)
				}
				, lineCurveThreshold = settings.lineWidth * 3
				, data
				, stroke
				, timer = null
				// shifts - adjustment values in viewport pixels drived from position of canvas on the page
				, shiftX
				, shiftY
				, dotShift = Math.round(settings.lineWidth / 2) * -1
				, x , y, vectorx, vectory
				, drawEnd = function() {
					clearTimeout(timer)
					x = y = null
					vectorx = vectory = 0
				}
				, setXY = function(e) {
					e.preventDefault()
					var first = (e.changedTouches && e.changedTouches.length > 0 ? e.changedTouches[0] : e)
					// All devices i tried report correct coordinates in pageX,Y
					// Android Chrome 2.3.x, 3.1, 3.2., Opera Mobile,  safari iOS 4.x,
					// Windows: Chrome, FF, IE9, Safari
					// None of that scroll shift calc vs screenXY other sigs do is needed.
					var newx = Math.round(first.pageX + shiftX)
						, newy = Math.round(first.pageY + shiftY)
					if (newx == x && newy == y){
						return false
					} else {
						// kick done-drawing timer down the line
						clearTimeout(timer)
						timer = setTimeout(
							drawEnd
							, 750 // no moving = done with the stroke.
						)
						x = newx
						y = newy
						return true
					}
				}
				, basicDot = function(x, y){
					ctx.fillStyle = settings.color
					ctx.fillRect(x + dotShift, y + dotShift, settings.lineWidth, settings.lineWidth)
					ctx.fillStyle = 'rgba(0,0,0,0)'					
				}
				, basicLine = function(startx, starty, endx, endy){
					ctx.beginPath()
					ctx.moveTo(startx, starty)
					ctx.lineTo(endx, endy)
					ctx.stroke()
				}
				, basicCurve = function(startx, starty, endx, endy, cp1x, cp1y, cp2x, cp2y){
					ctx.beginPath()
					ctx.moveTo(startx, starty)
					ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endx, endy)
					ctx.stroke()
				}
				, polarity = function (e){
					return Math.round(e / Math.abs(e))
				}
				, getCP1 = function(vectorx, vectory, boundx, boundy){
					var x, y
						, tan = Math.min(
							Math.min(boundx, boundy)
							, Math.max(boundx / 2, boundy / 2)
						)
					
					if (vectorx === 0 && vectory === 0){
						x = 0
						y = 0
					} else if (vectorx === 0){
						x = 0
						y = tan * polarity(vectory)
					} else if(vectory === 0) {
						x = tan * polarity(vectorx)
						y = 0
					} else {
						var proportion = Math.abs(vectory / vectorx)
						x = Math.sqrt(Math.pow(tan, 2) / (1 + Math.pow(proportion, 2)))
						y = proportion * x
						x = x * polarity(vectorx)
						y = y * polarity(vectory)
					}
					return {
						'x': x
						, 'y': y 
					}
				}
				, drawStart = function(e) {
					setXY(e)
					basicDot(x, y)
					stroke = {'x':[x], 'y':[y]}
					data.push(stroke)
				}
				, drawMove = function(e) {
					if (x == null || y == null) {
						return
					}
					
					var startx = x
						, starty = y
					if( setXY(e) ){
						stroke.x.push(x)
						stroke.y.push(y)
						var newvectorx = x - startx
							, newvectorxm = Math.abs(newvectorx)
							, newvectory = y - starty
							, newvectorym = Math.abs(newvectory)
						if (newvectorxm < lineCurveThreshold && newvectorym < lineCurveThreshold ){
							basicLine(startx, starty, x, y)
						} else {
							var cp = getCP1(vectorx, vectory, newvectorxm, newvectorym)
							basicCurve(
								startx, starty
								, x, y
								, startx + cp.x, starty + cp.y
								, x, y
							)
						}
						vectorx = newvectorx
						vectory = newvectory
					}
				}
				, setStartValues = function(){
					var tos = $(canvas).offset()
					shiftX = tos.left * -1
					shiftY = tos.top * -1
				}
				, renderStrokes = function(strokes){
					// used for rendering signature strokes passed from external sources.
					if (strokes.length){
						var strokecnt = strokes.length
							, stroke
							, pointid
							, pointcnt
						for(var strokeid = 0; strokeid < strokecnt; strokeid++){
							stroke = strokes[strokeid]
							pointcnt = stroke.length
							basicDot(stroke.x[0], stroke.y[0])
							//for(pointid = 1; strokeid < strokecnt; strokeid++){
						}
					}
				}

			canvas.ontouchstart = function(e) {
				canvas.onmousedown = null
				setStartValues()
				canvas.ontouchstart = drawStart
				canvas.ontouchend = drawEnd
				canvas.ontouchmove = drawMove
				drawStart(e)
			}
			canvas.onmousedown = function(e) {
				canvas.ontouchstart = null
				setStartValues()
				canvas.onmousedown = drawStart
				canvas.onmouseup = drawEnd
				canvas.onmousemove = drawMove
				drawStart(e)
			}
			$canvas.data('signature.clear', resetCanvas)
			
			resetCanvas()
			drawEnd()
		})
	}
	, clear : function( ) {
		var $this = $(this)
		try {
			$this.children('canvas').data('signature.clear')()				
		} catch (ex) {
			// pass
		}
		return $this
	}
	, getData : function(formattype) {
		var canvas=$(this).children('canvas').get(0)
		if (!canvas){
			return
		} else {
			switch (formattype) {
				case 'image':
					return canvas.toDataURL()
				default:
					return $(canvas).data('signature.data')
			}
		}
	}
//		importData : function( dataurl ) {
//			var img=new Image()
//			var cv=$(this).children("canvas")[0]
//			img.src=dataurl
//			img.onload=function() {
//				var dw=(img.width < cv.width) ? img.width : cv.width
//				var dh=(img.height < cv.height) ? img.height : cv.height
//				cv.getContext("2d").drawImage(img,0,0,dw,dh)
//			}
//		}
}

$.fn.jSignature = function(method) {
	if ( methods[method] ) {
		return methods[method].apply( this, Array.prototype.slice.call( arguments, 1 ))
	} else if ( typeof method === 'object' || ! method ) {
		return methods.init.apply( this, arguments )
	} else {
		$.error( 'Method ' +  method + ' does not exist on jQuery.jSignature' )
	}    
}
})(jQuery)
