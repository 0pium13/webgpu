"""
Halve GFPGANv1.4's download (340MB -> 170MB) without changing its output.

Plain fp16 conversion breaks GFPGAN (activations overflow -> flat colour
output). Instead, store large weights as fp16 and Cast them back to fp32 at
load; all compute stays fp32. Verified on WebGPU (ORT 1.23): PSNR 85.6dB vs
the fp32 model, same speed.

  pip install onnx numpy
  curl -L -o fp32.onnx https://huggingface.co/Meeperomi/GFPGANv1.4-onnx/resolve/main/GFPGANv1.4.onnx
  python scripts/gfpgan_fp16_weights.py fp32.onnx GFPGANv1.4-w16.onnx
"""
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
casts = []
for init in list(g.initializer):
    if init.data_type == TensorProto.FLOAT and np.prod(init.dims) >= 4096:
        half = numpy_helper.from_array(numpy_helper.to_array(init).astype(np.float16), init.name + "__fp16")
        g.initializer.remove(init)
        g.initializer.append(half)
        casts.append(helper.make_node("Cast", [half.name], [init.name], to=TensorProto.FLOAT, name=init.name + "__cast"))
nodes = list(g.node)
del g.node[:]
g.node.extend(casts + nodes)
onnx.save(m, dst)
print(f"{len(casts)} weights stored as fp16 -> {dst}")
