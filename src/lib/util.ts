const regImageFile = /(jpg|jpeg|png|gif|svg|bmp|pic)$/

export const isImageFile = function(type: string) {
  return regImageFile.test(type)
}
