class Memory {
  constructor(size) {
    this.ram = new Uint8Array(size);
  }

  read8(addr) { return this.ram[addr]; }
  write8(addr, val) { this.ram[addr] = val & 0xff; }

  read32(addr) {
    return this.ram[addr] | (this.ram[addr+1]<<8) | (this.ram[addr+2]<<16) | (this.ram[addr+3]<<24);
  }

  write32(addr, val) {
    this.ram[addr] = val & 0xff;
    this.ram[addr+1] = (val >> 8) & 0xff;
    this.ram[addr+2] = (val >> 16) & 0xff;
    this.ram[addr+3] = (val >> 24) & 0xff;
  }

  writeBytes(addr, bytes) {
    this.ram.set(bytes, Number(addr));
  }
}

class CPU {
  constructor(mem, output) {
    this.x = new BigUint64Array(32);
    this.pc = 0n;
    this.mem = mem;
    this.output = output;
  }

  fetch32() {
    const val = this.mem.read32(Number(this.pc));
    this.pc += 4n;
    return val;
  }

  step() {
    const instr = this.fetch32();

    const opcode = instr & 0x7f;
    if (opcode === 0x73) { // ECALL
      const syscall = Number(this.x[17]); // a7
      if(syscall === 64) { // write
        const ptr = Number(this.x[10]); // a0 fd
        const strAddr = Number(this.x[11]); // a1
        const len = Number(this.x[12]); // a2
        for(let i=0;i<len;i++){
          const ch = this.mem.read8(strAddr+i);
          this.output.textContent += String.fromCharCode(ch);
        }
      } else if(syscall === 93) { // exit
        return true; // stop execution
      }
      return false;
    } 
    else if(opcode === 0x13) { // ADDI
      const rd = (instr>>7)&0x1f;
      const funct3 = (instr>>12)&0x7;
      const rs1 = (instr>>15)&0x1f;
      let imm = BigInt((instr>>20)&0xfff);
      if(imm & 0x800n) imm |= ~0xfffn; // sign extend
      if(funct3 === 0) this.x[rd] = this.x[rs1]+imm;
    }
    else if(opcode === 0x37) { // LUI
      const rd = (instr>>7)&0x1f;
      let imm = BigInt(instr & 0xfffff000);
      this.x[rd] = imm;
    }
    else if(opcode === 0x6f) { // JAL
      const rd = (instr>>7)&0x1f;
      let imm = (((instr>>21)&0x3ff)<<1) |
                (((instr>>20)&1)<<11) |
                (((instr>>12)&0xff)<<12) |
                (((instr>>31)&1)<<20);
      if(imm & 0x100000) imm |= ~0xfffff; // sign extend
      this.x[rd] = this.pc;
      this.pc += BigInt(imm-4); // pc already incremented
    }
    else {
      this.output.textContent += `\nUnhandled instr: 0x${instr.toString(16)}`;
      return true;
    }
    return false;
  }

  run(steps=100000) {
    let stop = false;
    for(let i=0;i<steps;i++){
      stop = this.step();
      if(stop) break;
    }
  }
}

// Load ELF or raw binary
function loadELF(buffer, mem) {
  const view = new DataView(buffer);
  const isELF = view.getUint32(0, false) === 0x7f454c46; // 0x7F 'E''L''F'
  if(!isELF) { // assume raw binary, load at 0x1000
    mem.writeBytes(0x1000, new Uint8Array(buffer));
    return 0x1000n;
  }

  const entry = view.getBigUint64(0x18, true);
  const phoff = view.getBigUint64(0x20, true);
  const phentsize = view.getUint16(0x36, true);
  const phnum = view.getUint16(0x38, true);

  for (let i = 0; i < phnum; i++) {
    const off = Number(phoff) + i*phentsize;
    const type = view.getUint32(off, true);
    if(type !== 1) continue; // PT_LOAD

    const pOffset = view.getBigUint64(off+8,true);
    const pVaddr  = view.getBigUint64(off+16,true);
    const pFilesz = view.getBigUint64(off+32,true);

    mem.writeBytes(pVaddr, new Uint8Array(buffer, Number(pOffset), Number(pFilesz)));
  }

  return entry;
}

// HTML bindings
const dropzone = document.getElementById("dropzone");
const runBtn = document.getElementById("runBtn");
const output = document.getElementById("output");

let elfBuffer = null;

dropzone.addEventListener("dragover", e=>{ e.preventDefault(); dropzone.classList.add("hover"); });
dropzone.addEventListener("dragleave", e=>{ dropzone.classList.remove("hover"); });
dropzone.addEventListener("drop", e=>{
  e.preventDefault();
  dropzone.classList.remove("hover");
  const file = e.dataTransfer.files[0];
  const reader = new FileReader();
  reader.onload = () => { elfBuffer = reader.result; runBtn.disabled = false; };
  reader.readAsArrayBuffer(file);
  dropzone.textContent = `Loaded: ${file.name}`;
});

runBtn.addEventListener("click", ()=>{
  if(!elfBuffer) return;
  output.textContent = "";
  const mem = new Memory(8*1024*1024); // 8 MiB RAM
  const cpu = new CPU(mem, output);
  cpu.pc = loadELF(elfBuffer, mem);
  cpu.run();
});
