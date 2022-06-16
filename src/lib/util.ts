import * as path from 'path'

const regImageFile = /(jpg|jpeg|png|gif|svg|bmp|pic)$/
const regVideoFile = /(avi|wmv|mpe?g|mov|ra?m|swf|flv|mp4)$/

export const isImageFile = function(type: string) {
  return regImageFile.test(type)
}

export const isVideoFile = function(type: string) {
  return regVideoFile.test(type)
}

export const parseTagging = function(tags) {
  if (tags) {
    if (Array.isArray(tags[0])) {
      tags = tags[0]
    }

    const tagging = {}
    tags.forEach(item => {
      tagging[item.Key] = item.Value
    })

    return tagging
  }
  
  return {}
}

export const getObjectType = function(objectName) {
  const basename = path.basename(objectName)

  return basename.split('__')[0]?.toLocaleLowerCase()
}
