import sys
from PIL import Image
out=sys.argv[1]; fs=sys.argv[2:]
ims=[Image.open(f) for f in fs]
h=max(i.height for i in ims); s=1400/h if h>1400 else 1
ims=[i.resize((int(i.width*s),int(i.height*s))) for i in ims]
W=sum(i.width for i in ims)+12*(len(ims)-1); H=max(i.height for i in ims)
sh=Image.new('RGB',(W,H),(30,30,30)); x=0
for i in ims: sh.paste(i,(x,0)); x+=i.width+12
sh.save(out)
