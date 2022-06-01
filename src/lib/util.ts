const path = require('path')

const regImageFile = /^\.(jpg|jpeg|png|gif|svg|bmp|pic)/

export const isImageFile = function(filepath: string) {
  const extname = path.extname(filepath)
  return regImageFile.test(extname)
}
