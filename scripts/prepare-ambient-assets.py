#!/usr/bin/env python3
"""Rebuild T17 clips from locally downloaded licensed sources; originals never enter Git.
Requires Python/numpy, ffmpeg. Usage: python scripts/prepare-ambient-assets.py SOURCE_DIR
"""
import hashlib,json,pathlib,subprocess,sys,tempfile,datetime
import numpy as np
root=pathlib.Path(__file__).resolve().parents[1];src=pathlib.Path(sys.argv[1]);out=root/'public/audio/ambient/v1';out.mkdir(parents=True,exist_ok=True)
oga='https://opengameart.org/content/'
rows=[
 ('rain','Mưa nhẹ',['1.mp3'],'Ylmir','rain-loopable','field-recording',0),
 ('waves','Sóng biển',[f'wave_0{i}_cc0-18363__jasinski__alkaibeach.flac' for i in range(1,5)],'jasinski; biên tập: qubodup','beach-ocean-waves','sound-recording',0),
 ('wind','Gió qua đồng',['wind.wav'],'Thimras','park-ambiences','field-recording',10),
 ('fire','Lửa reo',['fire.wav'],'PagDev','fireplace-sound-loop','sound-recording',0),
 ('forest','Chim trong cây',['forest.wav'],'Thimras','park-ambiences','field-recording',10),
 ('night','Dế đêm',['night.mp3'],'Ted Kerr (Wolfgang_)','crickets-ambient-noise-loopable','sound-recording',0),
 ('stream','Dòng suối',['stream.wav'],'Thimras','park-ambiences','field-recording',10),
 ('lullaby','Nhạc chuông ru',['lullaby.mp3'],'cynicmusic','happy-lullaby-song17','music',0),
]
tracks=[]
for id,label,files,author,slug,kind,offset in rows:
 chunks=[]
 for name in files:
  cmd=['ffmpeg','-v','error','-ss',str(offset),'-i',str(src/name)]
  if kind!='music':cmd+=['-t','32']
  cmd+=['-f','f32le','-ac','1','-ar','24000','pipe:1']
  samples=np.frombuffer(subprocess.check_output(cmd),dtype='<f4').copy()
  if len(samples)<24000*2:raise ValueError('Clip too short: '+name)
  if chunks:
   n=min(24000//2,len(samples)//8,len(chunks[-1])//8);a=np.linspace(0,1,n,dtype=np.float32)
   chunks[-1]=np.concatenate([chunks[-1][:-n],chunks[-1][-n:]*(1-a)+samples[:n]*a]);samples=samples[n:]
  chunks.append(samples)
 x=np.concatenate(chunks)
 # Circular equal-amplitude crossfade: never insert a silent hole at loop boundary.
 n=min(int(24000*(0.06 if kind=='music' else 0.75)),len(x)//8);a=np.linspace(0,1,n,dtype=np.float32)
 x=np.concatenate([x[n:-n],x[-n:]*(1-a)+x[:n]*a])
 with tempfile.TemporaryDirectory() as td:
  raw=pathlib.Path(td)/'loop.f32';raw.write_bytes(x.astype('<f4').tobytes());target=out/(id+'.mp3')
  subprocess.run(['ffmpeg','-y','-v','error','-f','f32le','-ar','24000','-ac','1','-i',str(raw),'-af','highpass=f=70,loudnorm=I=-28:TP=-9:LRA=7','-ar','24000','-ac','1','-c:a','libmp3lame','-b:a','80k','-map_metadata','-1',str(target)],check=True)
 duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(target)],text=True))
 tracks.append(dict(id=id,label=label,url=f'/audio/ambient/v1/{id}.mp3',author=author,source=oga+slug,license='CC0 1.0',licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/',kind=kind,sha256=hashlib.sha256(target.read_bytes()).hexdigest(),bytes=target.stat().st_size,duration=duration,sourceFiles=[dict(name=name,sha256=hashlib.sha256((src/name).read_bytes()).hexdigest()) for name in files]))
 print(id,round(duration,2),target.stat().st_size)
manifest={'version':1,'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'processing':'Mono 24 kHz MP3 80 kbps; excerpt, circular crossfade, highpass 70 Hz, loudnorm -28 LUFS / -9 dBTP / LRA7. Lullaby is licensed composed music, not a field recording.','tracks':tracks}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('TOTAL_BYTES',sum(t['bytes'] for t in tracks))
