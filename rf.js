/* RF reference model. Units: metres, MHz, watts, dBi, and dB. */
(() => {
  "use strict";
  const VERSION = "2.1.0-beta.1", PRESET_VERSION = "2026-11-21.1", MI = 1609.344;
  const presets = [
    ["eng2", "2 GHz ENG (dish-to-dish)",2050,7,20,1],
    ["eng65","6.5 GHz ENG (dish-to-dish)",6475,1,30,1],
    ["eng7","7 GHz ENG (dish-to-dish)",7000,1,30,1],
    ["aircraft","Aircraft VHF (installed)",127,10,0,2],
    ["marine","Marine VHF (fixed mount)",156.8,25,0,2],
    ["vhf","Land mobile VHF",155,25,0,2],
    ["uhf","Land mobile UHF",460,25,0,2],
    ["ps700","Public safety 700 MHz (mobile)",770,30,0,2],
    ["ps800","Public safety 800 MHz (mobile)",855,35,0,2],
    ["gmrs","GMRS (handheld)",462.6,5,0,0]
  ].map(([id,label,frequencyMHz,powerW,gainDbi,lossDb])=>Object.freeze({id,label,frequencyMHz,powerW,gainDbi,lossDb}));
  function number(value,label,min=-Infinity,strict=false) {
    if((typeof value!=="number" && typeof value!=="string") || String(value).trim()==="")
      throw new Error(label+" is required.");
    const n=Number(value);
    if(!Number.isFinite(n) || (strict?n<=min:n<min))
      throw new Error(label+" must be a finite number"+(min===-Infinity?".":strict?" greater than "+min+".":" at least "+min+"."));
    return n;
  }
  const positive=(v,label)=>number(v,label,0,true);
  const wattsToDbm=w=>10*Math.log10(positive(w,"Output power"))+30;
  function freeSpaceLoss(distanceM,frequencyMHz) {
    // Sum logarithms to avoid overflowing the intermediate product.
    return 20*(Math.log10(4*Math.PI/299792458)+Math.log10(positive(distanceM,"Distance"))+
      Math.log10(positive(frequencyMHz,"Frequency"))+6);
  }
  function endpoint(e,label) {
    return Object.freeze({powerW:positive(e?.powerW,label+" power"),
      txGainDbi:number(e?.txGainDbi,label+" TX gain"),txLossDb:number(e?.txLossDb,label+" TX loss",0),
      rxGainDbi:number(e?.rxGainDbi,label+" RX gain"),rxLossDb:number(e?.rxLossDb,label+" RX loss",0)});
  }
  function calculate(input) {
    const distanceM=positive(input.distanceM,"Distance"),frequencyMHz=positive(input.frequencyMHz,"Frequency");
    const reverseFrequencyMHz=input.reverseFrequencyMHz===undefined?frequencyMHz:positive(input.reverseFrequencyMHz,"Reverse frequency");
    const a=endpoint(input.a,"Site A"),b=endpoint(input.b,"Site B");
    function direction(tx,rx,f) {
      const txDbm=wattsToDbm(tx.powerW),eirpDbm=txDbm+tx.txGainDbi-tx.txLossDb,fsplDb=freeSpaceLoss(distanceM,f);
      const receivedDbm=eirpDbm-fsplDb+rx.rxGainDbi-rx.rxLossDb;
      if(![txDbm,eirpDbm,fsplDb,receivedDbm].every(Number.isFinite))throw new Error("Inputs exceed the numerical range of this model.");
      return Object.freeze({frequencyMHz:f,txDbm,eirpDbm,fsplDb,receivedDbm});
    }
    return Object.freeze({distanceM,a,b,ab:direction(a,b,frequencyMHz),ba:direction(b,a,reverseFrequencyMHz)});
  }
  function equipment(p) {return {powerW:p.powerW,txGainDbi:p.gainDbi,txLossDb:p.lossDb,rxGainDbi:p.gainDbi,rxLossDb:p.lossDb};}
  function horizon(aFt,bFt,k=4/3) {
    const a=number(aFt,"Site A height",0)*.3048,b=number(bFt,"Site B height",0)*.3048;
    const radius=6371000*positive(k,"Effective Earth factor");
    return Math.sqrt(2*radius*a)+Math.sqrt(2*radius*b);
  }
  window.TowerRF=Object.freeze({VERSION,PRESET_VERSION,MI,presets:Object.freeze(presets),
    preset:id=>presets.find(p=>p.id===id),number,equipment,wattsToDbm,freeSpaceLoss,calculate,horizon});
})();
