const imgMin = require('imagemin')
const imageminJPG = require('imagemin-mozjpeg')
const imageminPNG = require('imagemin-pngquant')
const imageminGIF = require('imagemin-gifsicle')
const imageminSVG = require('imagemin-svgo')
const path = require('path')

const jpgPlugin = imageminJPG({
  quality: 60
})
const pngPlugin = imageminPNG({
  quality: [0.6, 0.8]
})
const gifPlugin = imageminGIF()
const svgPlugin = imageminSVG() 
const plugins = {
  jpg: jpgPlugin,
  jpeg: jpgPlugin,
  png: pngPlugin,
  gif: gifPlugin,
  svg: svgPlugin
}

export const imagemin = async function(filepath: string, destination: string) {
  const extname = path.extname(filepath).substr(1)
  const plugin = plugins[extname]

  if (plugin) {
    return await imgMin([filepath], {
      destination,
      plugins: [
        plugin
      ]
    })
  }

  return
}
