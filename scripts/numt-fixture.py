#!/usr/bin/env python3
"""Synthetic genome with planted NUMT-like copies, to check numt-screen.mjs. Usage: numt-fixture.py <empty-dir>.

Expect numt_like flagged, tiny not-assessed, the others no-signal, and scaf_mito reported as organelle-like. Pass --exclude MT."""
import random,sys
random.seed(7); B='ACGT'
d=sys.argv[1]
rs=lambda n:''.join(random.choice(B) for _ in range(n))
def mut(s,f):
    s=list(s)
    for i in random.sample(range(len(s)),int(len(s)*f)):
        s[i]=random.choice([b for b in B if b!=s[i]])
    return ''.join(s)
def rc(s): return s[::-1].translate(str.maketrans('ACGT','TGCA'))
ref='ATG'+rs(1137)
mito=rs(5000)+ref+rs(5000)
numt=mut(ref[200:900],0.08)
g={'chr1':rs(100000)+numt+rs(100000),'chr2':rs(80000)+rc(mut(ref[100:600],0.12))+rs(80000),'scaf_mito':mut(mito[3000:9000],0.01)+rs(500),'chr3':rs(120000),'MT':mito}
open(d+'/genome.fna','w').write(''.join(f'>{k}\n{v}\n' for k,v in g.items()))
open(d+'/mito.fasta','w').write(f'>mito\n{mito}\n')
open(d+'/ref.fasta','w').write(f'>ref\n{ref}\n')
gap=lambda s,a,b:'-'*a+s[a:b]+'-'*(len(s)-b)
recs={'clean_full':mut(ref,0.02),'numt_like':gap(ref,0,200)[:200]+mut(numt,0.005)+'-'*240,'tiny':gap(mut(ref,0.01),1000,1080),'clean_frag':gap(mut(ref,0.01),0,430)}
open(d+'/aligned.fasta','w').write(''.join(f'>{k}\n{v}\n' for k,v in recs.items()))
