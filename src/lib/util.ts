const regImageFile = /(jpg|jpeg|png|gif|svg|bmp|pic)$/

export const isImageFile = function(type: string) {
  return regImageFile.test(type)
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
