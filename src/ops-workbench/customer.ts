import {text} from './domain';
type Row=Record<string,any>;
export function customerDetails(raw:Row){
 const c={buyerType:raw.buyerType==='business'?'business':'person',name:text(raw.name,180),orgnr:text(raw.orgnr,20).replace(/\s/g,''),email:text(raw.email,200),address:text(raw.address,400),postalCode:text(raw.postalCode,20),city:text(raw.city,100),country:text(raw.country,200).toUpperCase()||'NO',reference:text(raw.reference,150)};
 if(!c.name)throw new Error('Oppgi kundenavn eller firmanavn.');
 if(c.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))throw new Error('Kontroller fakturaadressen for e-post.');
 if(!/^[A-Z]{2}$/.test(c.country))throw new Error('Bruk landkode med to bokstaver, for eksempel NO.');
 if(c.orgnr&&!/^\d{9}$/.test(c.orgnr))throw new Error('Organisasjonsnummer skal ha ni sifre.');
 if(c.buyerType==='business'&&!c.orgnr)throw new Error('Oppgi organisasjonsnummer for bedriftskunden.');
 if(c.country==='NO'&&c.postalCode&&!/^\d{4}$/.test(c.postalCode))throw new Error('Norsk postnummer skal ha fire sifre.');
 return c;
}
export function invoiceBasis(c:Row,customer:Row,q:Row|null,state:Row|null){
 const missing:string[]=[];
 if(!q)missing.push('Akseptert tilbud');
 for(const [key,label] of [['name','Kundenavn'],['email','Fakturaadresse for e-post'],['address','Fakturaadresse'],['postalCode','Postnummer'],['city','Poststed']] as const)if(!customer[key])missing.push(label);
 if(customer.buyerType==='business'&&!customer.orgnr)missing.push('Organisasjonsnummer');
 if(c.is_test)missing.push('Testsak kan ikke faktureres');
 const s=q?JSON.parse(q.snapshot_json):null;
 return {schemaVersion:1,documentType:'INVOICE_BASIS',invoiceCreated:false,ready:missing.length===0,missing,
 case:{id:c.id,reference:'FBG-'+c.id,regnr:c.regnr,isTest:!!c.is_test},
 seller:s?.seller??{name:'BLYT AS',orgnr:'929003292'},customer,
 offer:q?{id:q.id,version:q.version,status:q.status,acceptedAt:q.accepted_at,currency:s.currency,vatRate:s.vatRate,lines:s.lines,totalOre:s.totalOre,netOre:s.netOre,vatOre:s.vatOre,product:{variantId:s.product.variant_id,varenr:s.product.varenr,eurokode:s.product.eurokode,description:s.product.varenavn},equipment:s.equipment,deliveryAddress:s.address,delivery:s.delivery,paymentTerms:s.paymentTerms}:null,
 workflow:{payment:state?.payment??'NOT_AGREED',delivery:state?.delivery??'NOT_ORDERED',supplierRef:state?.supplier_ref??''},
 notice:'Dette er et fakturagrunnlag, ikke en faktura. Kontroller kunde, mva, betaling og levering i valgt fakturaprogram. Ingen ekstern integrasjon er aktivert.'};
}
